import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { type SplitPartInput, isComplete } from '../domain/classify';
import { fmt } from '../domain/format';
import type { BudgetMap, CsvMapConfig, TransactionRow, TxKind } from '../domain/models';
import { normalizeRows, parseAmount } from '../domain/parse';
import { typicalMonthly } from '../domain/report';
import { copyText } from '../kit/storage-utils';
import { ToastService } from '../kit/toast.service';
import { MoneyModalsService } from '../services/money-modals.service';
import { MoneyStateService } from '../services/money-state.service';

interface SplitDraftPart {
  desc: string;
  amount: string;
  cat: string;
  sub: string;
}

function syncNativeDialog(el: HTMLDialogElement | undefined, shouldOpen: boolean): void {
  if (!el) return;
  if (shouldOpen && !el.open) el.showModal();
  else if (!shouldOpen && el.open) el.close();
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'mm-dialogs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Text / Password Prompt -->
    <dialog #promptDlg class="modal" (cancel)="cancelPrompt($event)">
      @if (modals.promptState(); as p) {
        <div class="modal-box max-w-md flex flex-col gap-3">
          <h3 class="font-bold text-lg">{{ p.title }}</h3>
          @if (p.note) {
            <p class="text-sm opacity-80">{{ p.note }}</p>
          }
          <label class="form-control w-full">
            <span class="label-text text-sm mb-1">{{ p.label || p.title }}</span>
            <input
              [type]="p.type || 'text'"
              class="input input-bordered w-full"
              [value]="modals.promptValue()"
              (input)="modals.promptValue.set($any($event.target).value)"
              (keydown.enter)="submitPrompt()"
            />
          </label>
          <div class="modal-action">
            <button type="button" class="btn btn-ghost" (click)="modals.closePrompt(null)">Cancel</button>
            <button type="button" class="btn btn-primary" (click)="submitPrompt()">
              {{ p.action || 'Continue' }}
            </button>
          </div>
        </div>
      }
    </dialog>

    <!-- Passkey Recovery Code -->
    <dialog #recoveryDlg class="modal" (cancel)="cancelRecovery($event)">
      @if (modals.recoveryState(); as r) {
        <div class="modal-box max-w-md flex flex-col gap-3">
          <h3 class="font-bold text-lg">Save your recovery code</h3>
          <p class="text-sm opacity-80">
            Write this code down or keep it in a password manager. You will need it if you switch devices or your passkey isn't available.
          </p>
          <div id="recovery-code" class="font-mono text-lg font-bold tracking-widest bg-base-200 p-3 rounded-lg text-center select-all">{{ r.code }}</div>
          <div class="flex flex-wrap justify-between gap-2 mt-2">
            <button type="button" class="btn btn-ghost btn-sm" (click)="copyRecovery(r.code)">Copy code</button>
            <div class="flex gap-2 ml-auto">
              <button type="button" class="btn btn-ghost" (click)="modals.closeRecovery(false)">Cancel</button>
              <button id="lock-confirm" type="button" class="btn btn-primary" (click)="modals.closeRecovery(true)">
                I saved it — turn on lock
              </button>
            </div>
          </div>
        </div>
      }
    </dialog>

    <!-- Monthly Budgets -->
    <dialog #budgetsDlg class="modal" (cancel)="cancelBudgets($event)">
      @if (modals.budgetsOpen()) {
        <div class="modal-box max-w-lg flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-bold text-lg">Monthly category budgets</h3>
            <span id="budget-total" class="font-semibold text-sm tabular-nums">
              Total {{ fmt(budgetTotalCents()) }} a month
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-ghost btn-xs" (click)="fillTypicalBudgets()">
              Use typical spending
            </button>
            <button type="button" class="btn btn-ghost btn-xs" (click)="clearAllBudgets()">Clear all</button>
          </div>
          <div class="max-h-80 overflow-y-auto flex flex-col gap-2 pr-1">
            @for (cat of expenseCatNames(); track cat) {
              <div class="flex items-center justify-between gap-3 py-1 border-b border-base-200">
                <div class="min-w-0">
                  <div class="font-medium text-sm">{{ cat }}</div>
                  @if (typicalCats()[cat]) {
                    <div class="text-xs opacity-65">Typical {{ fmt(typicalCats()[cat]) }}/mo</div>
                  }
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <span class="text-sm opacity-70">$</span>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    class="input input-bordered input-sm w-28 text-right tabular-nums"
                    [attr.aria-label]="'Budget for ' + cat"
                    [value]="budgetDraft()[cat] || ''"
                    (input)="setBudgetInput(cat, $any($event.target).value)"
                  />
                </div>
              </div>
            }
          </div>
          <div class="modal-action">
            <button type="button" class="btn btn-ghost" (click)="modals.closeBudgets()">Cancel</button>
            <button
              id="budgets-save"
              type="button"
              class="btn btn-primary"
              [disabled]="hasNegativeBudget()"
              (click)="saveBudgets()"
            >
              Save budgets
            </button>
          </div>
        </div>
      }
    </dialog>

    <!-- Split Transaction -->
    <dialog #splitDlg class="modal" (cancel)="cancelSplit($event)">
      @if (modals.splitState(); as req) {
        <div class="modal-box max-w-xl flex flex-col gap-3">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="font-bold text-lg">Split {{ req.parent.desc }}</h3>
            <span class="font-semibold text-sm tabular-nums">{{ fmt(Math.abs(req.parent.cents)) }}</span>
          </div>
          <p id="split-summary" class="text-sm" [class.text-warning]="splitRemainingCents() !== 0">
            @if (splitRemainingCents() === 0) {
              fully assigned
            } @else if (splitRemainingCents() > 0) {
              {{ fmt(splitRemainingCents()) }} left
            } @else {
              {{ fmt(-splitRemainingCents()) }} too much
            }
          </p>

          <div class="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
            @for (part of splitParts(); track $index) {
              <div class="border border-base-300 rounded-lg p-3 flex flex-col gap-2">
                <div class="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    class="input input-bordered input-sm flex-1 min-w-40"
                    placeholder="Part description"
                    [attr.aria-label]="'Part ' + ($index + 1) + ' description'"
                    [value]="part.desc"
                    (input)="updateSplitPart($index, { desc: $any($event.target).value })"
                  />
                  <input
                    type="text"
                    inputmode="decimal"
                    class="input input-bordered input-sm w-28 text-right tabular-nums"
                    placeholder="0.00"
                    [attr.aria-label]="'Part ' + ($index + 1) + ' amount'"
                    [value]="part.amount"
                    (input)="updateSplitPart($index, { amount: $any($event.target).value })"
                  />
                  @if (splitParts().length > 2) {
                    <button type="button" class="btn btn-ghost btn-xs text-error" (click)="removeSplitPart($index)">
                      Remove
                    </button>
                  }
                </div>
                <div class="flex flex-wrap gap-2">
                  <select
                    class="select select-bordered select-sm flex-1 min-w-36"
                    [attr.aria-label]="'Part ' + ($index + 1) + ' category'"
                    (change)="updateSplitPart($index, { cat: $any($event.target).value, sub: '' })"
                  >
                    <option value="" [selected]="!part.cat">— Category —</option>
                    @for (c of activeExpenseCats(); track c) {
                      <option [value]="c" [selected]="part.cat === c">{{ c }}</option>
                    }
                  </select>
                  <select
                    class="select select-bordered select-sm flex-1 min-w-36"
                    [attr.aria-label]="'Part ' + ($index + 1) + ' subcategory'"
                    [disabled]="!part.cat"
                    (change)="updateSplitPart($index, { sub: $any($event.target).value })"
                  >
                    <option value="" [selected]="!part.sub">— Subcategory —</option>
                    @for (s of subsFor(part.cat); track s) {
                      <option [value]="s" [selected]="part.sub === s">{{ s }}</option>
                    }
                  </select>
                </div>
              </div>
            }
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 mt-1">
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn btn-ghost btn-sm" (click)="addSplitPart()">+ Add part</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="fillRemainderInLast()">
                Put the rest in the last part
              </button>
            </div>
            <div class="flex gap-2 ml-auto">
              <button type="button" class="btn btn-ghost" (click)="modals.closeSplit(false)">Cancel</button>
              <button
                id="split-save"
                type="button"
                class="btn btn-primary"
                [disabled]="!splitValid()"
                (click)="saveSplit()"
              >
                Save split
              </button>
            </div>
          </div>
        </div>
      }
    </dialog>

    <!-- Add Manual Transaction -->
    <dialog #addTxDlg class="modal" (cancel)="cancelAddTx($event)">
      @if (modals.addTxOpen()) {
        <div class="modal-box max-w-md flex flex-col gap-3">
          <h3 class="font-bold text-lg">Add transaction</h3>
          <div class="grid grid-cols-1 gap-2">
            <label class="form-control">
              <span class="label-text text-xs mb-1">Date</span>
              <input
                type="date"
                class="input input-bordered input-sm"
                aria-label="Date"
                [value]="addDate()"
                (input)="addDate.set($any($event.target).value)"
              />
            </label>
            <label class="form-control">
              <span class="label-text text-xs mb-1">Account</span>
              <input
                type="text"
                class="input input-bordered input-sm"
                aria-label="Account"
                placeholder="Cash"
                [value]="addAccount()"
                (input)="addAccount.set($any($event.target).value)"
              />
            </label>
            <label class="form-control">
              <span class="label-text text-xs mb-1">Description</span>
              <input
                type="text"
                class="input input-bordered input-sm"
                aria-label="Description"
                placeholder="Farmers market"
                [value]="addDesc()"
                (input)="addDesc.set($any($event.target).value)"
              />
            </label>
            <label class="form-control">
              <span class="label-text text-xs mb-1">Amount ($)</span>
              <input
                type="text"
                inputmode="decimal"
                class="input input-bordered input-sm"
                aria-label="Amount"
                placeholder="25.00"
                [value]="addAmount()"
                (input)="addAmount.set($any($event.target).value)"
              />
            </label>
            <label class="form-control">
              <span class="label-text text-xs mb-1">Type</span>
              <select
                class="select select-bordered select-sm"
                aria-label="Type"
                (change)="onAddKindChange($any($event.target).value)"
              >
                <option value="expense" [selected]="addKind() === 'expense'">Expense</option>
                <option value="income" [selected]="addKind() === 'income'">Income</option>
                <option value="savings" [selected]="addKind() === 'savings'">Savings</option>
                <option value="transfer" [selected]="addKind() === 'transfer'">Transfer</option>
              </select>
            </label>

            @if (addKind() === 'expense') {
              <label class="form-control">
                <span class="label-text text-xs mb-1">Category</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Category"
                  (change)="addCat.set($any($event.target).value); addSub.set('')"
                >
                  <option value="" [selected]="!addCat()">— Category —</option>
                  @for (c of expenseCatNames(); track c) {
                    <option [value]="c" [selected]="addCat() === c">{{ c }}</option>
                  }
                </select>
              </label>
              <label class="form-control">
                <span class="label-text text-xs mb-1">Subcategory</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Subcategory"
                  [disabled]="!addCat()"
                  (change)="addSub.set($any($event.target).value)"
                >
                  <option value="" [selected]="!addSub()">— Subcategory —</option>
                  @for (s of addSubs(); track s) {
                    <option [value]="s" [selected]="addSub() === s">{{ s }}</option>
                  }
                </select>
              </label>
            } @else if (addKind() === 'income') {
              <label class="form-control">
                <span class="label-text text-xs mb-1">Source</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Source"
                  (change)="addSub.set($any($event.target).value)"
                >
                  @for (s of state.incomeSources(); track s) {
                    <option [value]="s" [selected]="addSub() === s">{{ s }}</option>
                  }
                </select>
              </label>
            } @else if (addKind() === 'savings') {
              <label class="form-control">
                <span class="label-text text-xs mb-1">Savings subcategory</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Savings subcategory"
                  (change)="addSub.set($any($event.target).value)"
                >
                  @for (s of savingsSubs(); track s) {
                    <option [value]="s" [selected]="addSub() === s">{{ s }}</option>
                  }
                </select>
              </label>
            }
          </div>
          @if (addError()) {
            <p class="text-error text-sm">{{ addError() }}</p>
          }
          <div class="modal-action">
            <button type="button" class="btn btn-ghost" (click)="modals.closeAddTx()">Cancel</button>
            <button
              id="add-confirm"
              type="button"
              class="btn btn-primary"
              [disabled]="!canSubmitAdd()"
              (click)="submitAddTx()"
            >
              Add transaction
            </button>
          </div>
        </div>
      }
    </dialog>

    <!-- CSV Column Mapper -->
    <dialog #mapperDlg class="modal" (cancel)="cancelMapper($event)">
      @if (modals.mapperState() && mapDraft(); as m) {
        <div class="modal-box max-w-2xl mapper flex flex-col gap-3">
          <h3 class="font-bold text-lg">Match columns for {{ modals.mapperState()!.file.fileName }}</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="form-control">
              <span class="label-text text-xs mb-1">Account name</span>
              <input
                type="text"
                class="input input-bordered input-sm"
                aria-label="Account name"
                [value]="m.account"
                (input)="patchMap({ account: $any($event.target).value })"
              />
            </label>
            <label class="form-control">
              <span class="label-text text-xs mb-1">Account type</span>
              <select
                class="select select-bordered select-sm"
                aria-label="Account type"
                (change)="patchMap({ accountType: $any($event.target).value })"
              >
                <option value="checking" [selected]="m.accountType === 'checking'">Checking / Savings</option>
                <option value="card" [selected]="m.accountType === 'card'">Credit Card</option>
              </select>
            </label>
            <label class="form-control">
              <span class="label-text text-xs mb-1">Date column</span>
              <select
                class="select select-bordered select-sm"
                aria-label="Date column"
                (change)="patchMap({ date: $any($event.target).value })"
              >
                @for (h of mapHeaders(); track h) {
                  <option [value]="h" [selected]="m.date === h">{{ h }}</option>
                }
              </select>
            </label>
            <label class="form-control">
              <span class="label-text text-xs mb-1">Description column</span>
              <select
                class="select select-bordered select-sm"
                aria-label="Description column"
                (change)="patchMap({ desc: $any($event.target).value })"
              >
                @for (h of mapHeaders(); track h) {
                  <option [value]="h" [selected]="m.desc === h">{{ h }}</option>
                }
              </select>
            </label>
            <label class="form-control">
              <span class="label-text text-xs mb-1">Amount layout</span>
              <select
                class="select select-bordered select-sm"
                aria-label="Amount layout"
                (change)="patchMap({ amountMode: $any($event.target).value })"
              >
                <option value="signed" [selected]="m.amountMode === 'signed'">One amount column (+/-)</option>
                <option value="debitCredit" [selected]="m.amountMode === 'debitCredit'">Separate debit & credit</option>
                <option value="amountType" [selected]="m.amountMode === 'amountType'">Amount + Type column</option>
              </select>
            </label>
            @if (m.amountMode === 'debitCredit') {
              <label class="form-control">
                <span class="label-text text-xs mb-1">Debit column</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Debit column"
                  (change)="patchMap({ debit: $any($event.target).value })"
                >
                  <option value="" [selected]="!m.debit">— None —</option>
                  @for (h of mapHeaders(); track h) {
                    <option [value]="h" [selected]="m.debit === h">{{ h }}</option>
                  }
                </select>
              </label>
              <label class="form-control">
                <span class="label-text text-xs mb-1">Credit column</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Credit column"
                  (change)="patchMap({ credit: $any($event.target).value })"
                >
                  <option value="" [selected]="!m.credit">— None —</option>
                  @for (h of mapHeaders(); track h) {
                    <option [value]="h" [selected]="m.credit === h">{{ h }}</option>
                  }
                </select>
              </label>
            } @else {
              <label class="form-control">
                <span class="label-text text-xs mb-1">Amount column</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Amount column"
                  (change)="patchMap({ amount: $any($event.target).value })"
                >
                  @for (h of mapHeaders(); track h) {
                    <option [value]="h" [selected]="m.amount === h">{{ h }}</option>
                  }
                </select>
              </label>
              @if (m.amountMode === 'signed') {
                <label class="form-control">
                  <span class="label-text text-xs mb-1">Purchases are shown as</span>
                  <select
                    class="select select-bordered select-sm"
                    aria-label="Purchases sign"
                    (change)="patchMap({ spendSign: +$any($event.target).value })"
                  >
                    <option value="-1" [selected]="(m.spendSign ?? -1) === -1">Negative (-$42.00)</option>
                    <option value="1" [selected]="m.spendSign === 1">Positive ($42.00)</option>
                  </select>
                </label>
              } @else {
                <label class="form-control">
                  <span class="label-text text-xs mb-1">Type column</span>
                  <select
                    class="select select-bordered select-sm"
                    aria-label="Type column"
                    (change)="patchMap({ type: $any($event.target).value })"
                  >
                    <option value="" [selected]="!m.type">— None —</option>
                    @for (h of mapHeaders(); track h) {
                      <option [value]="h" [selected]="m.type === h">{{ h }}</option>
                    }
                  </select>
                </label>
              }
            }
          </div>

          <label class="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              [checked]="mapRemember()"
              (change)="mapRemember.set($any($event.target).checked)"
            />
            <span class="label-text text-sm">Remember columns for this bank</span>
          </label>

          <div class="map-preview overflow-x-auto border border-base-300 rounded-lg p-2">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th class="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                @for (r of mapPreviewRows(); track $index) {
                  <tr>
                    <td>{{ r.date }}</td>
                    <td>{{ r.desc }}</td>
                    <td class="text-right tabular-nums">
                      {{ r.cents < 0 ? 'received ' + fmt(-r.cents) : 'spent ' + fmt(r.cents) }}
                    </td>
                  </tr>
                }
                @if (!mapPreviewRows().length) {
                  <tr>
                    <td colspan="3" class="opacity-65">No valid preview rows with current columns.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="modal-action">
            <button type="button" class="btn btn-ghost" (click)="modals.closeMapper(false)">Cancel</button>
            <button type="button" class="btn btn-primary" (click)="saveMapper()">Use this format</button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class DialogsComponent {
  readonly modals = inject(MoneyModalsService);
  readonly state = inject(MoneyStateService);
  private readonly toast = inject(ToastService);

  private readonly promptDlg = viewChild<ElementRef<HTMLDialogElement>>('promptDlg');
  private readonly recoveryDlg = viewChild<ElementRef<HTMLDialogElement>>('recoveryDlg');
  private readonly budgetsDlg = viewChild<ElementRef<HTMLDialogElement>>('budgetsDlg');
  private readonly splitDlg = viewChild<ElementRef<HTMLDialogElement>>('splitDlg');
  private readonly addTxDlg = viewChild<ElementRef<HTMLDialogElement>>('addTxDlg');
  private readonly mapperDlg = viewChild<ElementRef<HTMLDialogElement>>('mapperDlg');

  readonly fmt = fmt;
  readonly Math = Math;

  // Budgets draft
  readonly budgetDraft = signal<Record<string, string>>({});
  readonly expenseCatNames = computed(() =>
    Object.keys(this.state.categories()).filter(c => c !== 'Savings'),
  );
  readonly typicalCats = computed(() => typicalMonthly(this.state.tx()).categories);
  readonly hasNegativeBudget = computed(() =>
    Object.values(this.budgetDraft()).some(v => v.trim() !== '' && Number(v) < 0),
  );
  readonly budgetTotalCents = computed(() =>
    Object.values(this.budgetDraft()).reduce((sum, v) => {
      const n = Math.round(Number(v) * 100);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0),
  );

  // Split draft
  readonly splitParts = signal<SplitDraftPart[]>([]);
  readonly activeCatsMap = computed(() => {
    const req = this.modals.splitState();
    return req?.isPending ? this.state.pendingCategories() : this.state.categories();
  });
  readonly activeExpenseCats = computed(() =>
    Object.keys(this.activeCatsMap()).filter(c => c !== 'Savings'),
  );
  readonly splitRemainingCents = computed(() => {
    const req = this.modals.splitState();
    if (!req) return 0;
    const allocated = this.splitParts().reduce((s, p) => s + (parseAmount(p.amount) || 0), 0);
    return Math.abs(req.parent.cents) - allocated;
  });
  readonly splitValid = computed(() => {
    if (this.splitRemainingCents() !== 0) return false;
    return this.splitParts().every(
      p => Boolean(p.desc.trim() && p.cat && p.sub && (parseAmount(p.amount) || 0) > 0),
    );
  });

  // Add transaction state
  readonly addDate = signal(todayIso());
  readonly addAccount = signal('Cash');
  readonly addDesc = signal('');
  readonly addAmount = signal('');
  readonly addKind = signal<TxKind>('expense');
  readonly addCat = signal('');
  readonly addSub = signal('');
  readonly addError = signal('');
  readonly addSubs = computed(() => this.state.categories()[this.addCat()] || []);
  readonly savingsSubs = computed(() => this.state.categories()['Savings'] || []);
  readonly canSubmitAdd = computed(() => {
    const date = this.addDate().trim();
    const desc = this.addDesc().trim();
    const parsed = parseAmount(this.addAmount());
    if (!date || !desc || parsed === null || parsed <= 0) return false;
    const kind = this.addKind();
    const cat = kind === 'savings' ? 'Savings' : kind === 'expense' ? this.addCat() : '';
    const sub = kind === 'transfer' ? '' : this.addSub();
    return isComplete({ kind, cat, sub });
  });

  // Mapper state
  readonly mapDraft = signal<CsvMapConfig | null>(null);
  readonly mapRemember = signal(true);
  readonly mapHeaders = computed(() => this.modals.mapperState()?.file.headers || []);
  readonly mapPreviewRows = computed(() => {
    const mReq = this.modals.mapperState();
    const map = this.mapDraft();
    if (!mReq || !map) return [];
    return normalizeRows(mReq.file.dataRows.slice(0, 6), mReq.file.headers, map).rows;
  });

  constructor() {
    effect(() => {
      const p = this.modals.promptState();
      queueMicrotask(() => syncNativeDialog(this.promptDlg()?.nativeElement, Boolean(p)));
    });

    effect(() => {
      const r = this.modals.recoveryState();
      queueMicrotask(() => syncNativeDialog(this.recoveryDlg()?.nativeElement, Boolean(r)));
    });

    effect(() => {
      const open = this.modals.budgetsOpen();
      if (open) {
        const cur = this.state.budgets();
        const next: Record<string, string> = {};
        for (const cat of Object.keys(this.state.categories())) {
          if (cat === 'Savings') continue;
          next[cat] = cur[cat] ? String(Math.round(cur[cat] / 100)) : '';
        }
        this.budgetDraft.set(next);
      }
      queueMicrotask(() => syncNativeDialog(this.budgetsDlg()?.nativeElement, open));
    });

    effect(() => {
      const req = this.modals.splitState();
      if (req) {
        if (req.siblings.length >= 2) {
          this.splitParts.set(
            req.siblings.map(s => ({
              desc: s.desc,
              amount: (Math.abs(s.cents) / 100).toFixed(2),
              cat: s.cat,
              sub: s.sub,
            })),
          );
        } else {
          const total = Math.abs(req.parent.cents);
          const first = Math.round(total / 2);
          const second = total - first;
          this.splitParts.set([
            {
              desc: req.parent.desc,
              amount: (first / 100).toFixed(2),
              cat: req.parent.cat || '',
              sub: req.parent.sub || '',
            },
            {
              desc: req.parent.desc,
              amount: (second / 100).toFixed(2),
              cat: '',
              sub: '',
            },
          ]);
        }
      }
      queueMicrotask(() => syncNativeDialog(this.splitDlg()?.nativeElement, Boolean(req)));
    });

    effect(() => {
      const open = this.modals.addTxOpen();
      if (open) {
        const fMonth = this.state.filter().month || '';
        this.addDate.set(/^\d{4}-\d{2}$/.test(fMonth) ? `${fMonth}-01` : todayIso());
        this.addAccount.set('Cash');
        this.addDesc.set('');
        this.addAmount.set('');
        this.addKind.set('expense');
        this.addCat.set('');
        this.addSub.set('');
        this.addError.set('');
      }
      queueMicrotask(() => syncNativeDialog(this.addTxDlg()?.nativeElement, open));
    });

    effect(() => {
      const mReq = this.modals.mapperState();
      if (mReq) {
        this.mapDraft.set(structuredClone(mReq.file.map));
        this.mapRemember.set(true);
      }
      queueMicrotask(() => syncNativeDialog(this.mapperDlg()?.nativeElement, Boolean(mReq)));
    });
  }

  /* ---------- Handlers ---------- */

  submitPrompt(): void {
    const val = this.modals.promptValue().trim();
    this.modals.closePrompt(val || null);
  }

  cancelPrompt(e: Event): void {
    e.preventDefault();
    this.modals.closePrompt(null);
  }

  cancelRecovery(e: Event): void {
    e.preventDefault();
    this.modals.closeRecovery(false);
  }

  async copyRecovery(code: string): Promise<void> {
    if (await copyText(code)) this.toast.show('Copied recovery code.');
  }

  setBudgetInput(cat: string, val: string): void {
    this.budgetDraft.update(prev => ({ ...prev, [cat]: val }));
  }

  fillTypicalBudgets(): void {
    const typ = this.typicalCats();
    const next: Record<string, string> = {};
    for (const cat of this.expenseCatNames()) {
      const rounded = Math.ceil((typ[cat] || 0) / 1000) * 10;
      next[cat] = rounded > 0 ? String(rounded) : '';
    }
    this.budgetDraft.set(next);
  }

  clearAllBudgets(): void {
    const next: Record<string, string> = {};
    for (const cat of this.expenseCatNames()) next[cat] = '';
    this.budgetDraft.set(next);
  }

  async saveBudgets(): Promise<void> {
    if (this.hasNegativeBudget()) return;
    const next: BudgetMap = {};
    for (const [cat, raw] of Object.entries(this.budgetDraft())) {
      const cents = Math.round(Number(raw) * 100);
      if (Number.isFinite(cents) && cents > 0) next[cat] = cents;
    }
    await this.state.saveBudgets(next);
    this.modals.closeBudgets();
  }

  cancelBudgets(e: Event): void {
    e.preventDefault();
    this.modals.closeBudgets();
  }

  subsFor(cat: string): string[] {
    return this.activeCatsMap()[cat] || [];
  }

  updateSplitPart(index: number, patch: Partial<SplitDraftPart>): void {
    this.splitParts.update(list => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  addSplitPart(): void {
    const rem = Math.max(0, this.splitRemainingCents());
    const parentDesc = this.modals.splitState()?.parent.desc || '';
    this.splitParts.update(list => [
      ...list,
      { desc: parentDesc, amount: (rem / 100).toFixed(2), cat: '', sub: '' },
    ]);
  }

  fillRemainderInLast(): void {
    const rem = this.splitRemainingCents();
    const list = this.splitParts();
    if (!list.length) return;
    const lastIdx = list.length - 1;
    const cur = parseAmount(list[lastIdx].amount) || 0;
    const nextCents = Math.max(0, cur + rem);
    this.updateSplitPart(lastIdx, { amount: (nextCents / 100).toFixed(2) });
  }

  removeSplitPart(index: number): void {
    this.splitParts.update(list => list.filter((_, i) => i !== index));
  }

  async saveSplit(): Promise<void> {
    const req = this.modals.splitState();
    if (!req || !this.splitValid()) return;
    const sign = req.parent.cents < 0 ? -1 : 1;
    const parts: SplitPartInput[] = this.splitParts().map(p => ({
      desc: p.desc.trim(),
      cents: sign * Math.abs(parseAmount(p.amount) || 0),
      kind: 'expense',
      cat: p.cat,
      sub: p.sub,
    }));
    await req.onSave(parts, req.siblings);
    this.modals.closeSplit(true);
  }

  cancelSplit(e: Event): void {
    e.preventDefault();
    this.modals.closeSplit(false);
  }

  onAddKindChange(next: string): void {
    const kind = next as TxKind;
    this.addKind.set(kind);
    if (kind === 'expense') {
      this.addCat.set('');
      this.addSub.set('');
    } else if (kind === 'income') {
      this.addCat.set('');
      this.addSub.set(this.state.incomeSources()[0] || 'Salary');
    } else if (kind === 'savings') {
      this.addCat.set('Savings');
      this.addSub.set(this.savingsSubs()[0] || 'India Remittance');
    } else {
      this.addCat.set('');
      this.addSub.set('');
    }
  }

  async submitAddTx(): Promise<void> {
    if (!this.canSubmitAdd()) return;
    const date = this.addDate().trim();
    const account = this.addAccount().trim() || 'Cash';
    const desc = this.addDesc().trim();
    const parsed = parseAmount(this.addAmount())!;
    const kind = this.addKind();
    const cents = kind === 'income' ? -Math.abs(parsed) : Math.abs(parsed);
    const cat = kind === 'savings' ? 'Savings' : kind === 'expense' ? this.addCat() : '';
    const sub = kind === 'transfer' ? '' : this.addSub();
    const row: TransactionRow = {
      id: `Manual|${date}|${cents}|${desc.toUpperCase()}|${Date.now()}`,
      account,
      accountType: 'cash',
      date,
      desc,
      cents,
      bankCategory: '',
      bankType: 'Manual',
      kind,
      cat,
      sub,
      needsReview: false,
      edited: true,
    };
    await this.state.addManualTx(row);
    this.modals.closeAddTx();
  }

  cancelAddTx(e: Event): void {
    e.preventDefault();
    this.modals.closeAddTx();
  }

  patchMap(patch: Partial<CsvMapConfig>): void {
    this.mapDraft.update(prev => (prev ? { ...prev, ...patch } : prev));
  }

  async saveMapper(): Promise<void> {
    const mReq = this.modals.mapperState();
    const draft = this.mapDraft();
    if (!mReq || !draft) return;
    Object.assign(mReq.file.map, draft);
    this.state.reapplyMap(mReq.file);
    if (this.mapRemember()) await this.state.rememberFormat(mReq.file);
    this.modals.closeMapper(true);
  }

  cancelMapper(e: Event): void {
    e.preventDefault();
    this.modals.closeMapper(false);
  }
}
