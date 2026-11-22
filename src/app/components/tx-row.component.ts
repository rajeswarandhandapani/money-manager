import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { isComplete } from '../domain/classify';
import { fmt, prettyDate } from '../domain/format';
import type { CategoryMap, TransactionRow, TxKind } from '../domain/models';
import { parseAmount } from '../domain/parse';

const KINDS: ReadonlyArray<{ value: TxKind; label: string }> = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'savings', label: 'Savings' },
  { value: 'transfer', label: 'Transfer' },
];

@Component({
  selector: 'mm-tx-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="tx flex flex-col gap-2"
      [class.review]="row().needsReview"
      [class.off]="row().kind === 'transfer'"
      [attr.data-id]="row().id"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 text-sm">
          <span class="opacity-70 whitespace-nowrap">{{ prettyDate(row().date) }}</span>
          <span class="opacity-50">·</span>
          <span class="opacity-80 whitespace-nowrap">{{ row().account }}</span>
          <span class="opacity-50">·</span>

          @if (editingDesc()) {
            <span class="desc-edit inline-flex flex-wrap items-center gap-1">
              <input
                type="text"
                class="input input-bordered input-xs w-64 max-w-full"
                aria-label="New description"
                [value]="descDraft()"
                (input)="descDraft.set($any($event.target).value)"
                (keydown.enter)="commitDesc()"
                (keydown.escape)="cancelDesc()"
              />
              <button type="button" class="btn btn-primary btn-xs" (click)="commitDesc()">Save</button>
              <button type="button" class="btn btn-ghost btn-xs" (click)="cancelDesc()">Cancel</button>
            </span>
          } @else {
            <strong class="break-words">{{ row().desc }}</strong>
            @if (row().splitOf) {
              <span class="badge badge-info badge-sm">Split</span>
            }
            @if (row().needsReview) {
              <span class="badge badge-warning badge-sm">Needs review</span>
            }
            <button type="button" class="btn btn-ghost btn-xs" (click)="startDescEdit()">
              Edit description
            </button>
          }
        </div>

        <div class="flex items-center gap-2 ml-auto shrink-0">
          @if (editingAmt()) {
            <span class="amt-edit inline-flex items-center gap-1">
              <input
                type="text"
                inputmode="decimal"
                class="input input-bordered input-xs w-24 text-right tabular-nums"
                aria-label="New amount"
                [value]="amtDraft()"
                (input)="amtDraft.set($any($event.target).value)"
                (keydown.enter)="commitAmt()"
                (keydown.escape)="cancelAmt()"
              />
              <button type="button" class="btn btn-primary btn-xs" (click)="commitAmt()">Save</button>
              <button type="button" class="btn btn-ghost btn-xs" (click)="cancelAmt()">Cancel</button>
            </span>
          } @else {
            <span
              class="font-semibold tabular-nums text-base"
              [class.text-success]="row().kind === 'income' || row().kind === 'savings'"
              [class.opacity-60]="row().kind === 'transfer'"
            >
              {{ amtText() }}
            </span>
            @if (!row().splitOf) {
              <button type="button" class="btn btn-ghost btn-xs" (click)="startAmtEdit()">
                Edit amount
              </button>
            }
          }
        </div>
      </div>

      @if (row().origDesc || row().origCents != null || row().splitParent) {
        <div class="flex flex-wrap gap-2 text-xs opacity-70">
          @if (row().origDesc) {
            <span>originally: {{ row().origDesc }}</span>
          }
          @if (row().splitParent) {
            <span>part {{ (row().splitIndex ?? 0) + 1 }} of a {{ fmt(Math.abs(row().splitParent!.cents)) }} transaction</span>
          }
          @if (row().origCents != null) {
            <span>original amount: {{ fmt(Math.abs(row().origCents!)) }}</span>
          }
        </div>
      }

      <div class="tx-controls flex flex-wrap items-center gap-2">
        <select
          class="select select-bordered select-sm min-h-9"
          aria-label="Type"
          (change)="onKindChange($any($event.target).value)"
        >
          @for (k of kinds; track k.value) {
            <option [value]="k.value" [selected]="row().kind === k.value">{{ k.label }}</option>
          }
        </select>

        @if (row().kind === 'expense') {
          <select
            class="select select-bordered select-sm min-h-9"
            aria-label="Category"
            [class.missing]="!row().cat"
            (change)="onCatChange($any($event.target))"
          >
            <option value="" [selected]="!row().cat">— Category —</option>
            @for (c of expenseCategories(); track c) {
              <option [value]="c" [selected]="row().cat === c">{{ c }}</option>
            }
            <option value="__new__">+ New category…</option>
          </select>

          <select
            class="select select-bordered select-sm min-h-9"
            aria-label="Subcategory"
            [class.missing]="!row().sub"
            [disabled]="!row().cat"
            (change)="onSubChange($any($event.target))"
          >
            <option value="" [selected]="!row().sub">— Subcategory —</option>
            @for (s of subs(); track s) {
              <option [value]="s" [selected]="row().sub === s">{{ s }}</option>
            }
            @if (row().cat) {
              <option value="__new__">+ New subcategory…</option>
            }
          </select>

          @if (row().cat && !row().sub) {
            <span class="text-xs text-warning font-medium">Choose a subcategory to save</span>
          } @else if (!row().cat) {
            <span class="text-xs text-warning font-medium">Choose a category to save</span>
          }
        } @else if (row().kind === 'income') {
          <select
            class="select select-bordered select-sm min-h-9"
            aria-label="Income source"
            (change)="onIncomeSourceChange($any($event.target))"
          >
            <option value="" [selected]="!row().sub">— Source —</option>
            @for (s of incomeSources(); track s) {
              <option [value]="s" [selected]="row().sub === s">{{ s }}</option>
            }
            <option value="__new__">+ New source…</option>
          </select>
        } @else if (row().kind === 'savings') {
          <select
            class="select select-bordered select-sm min-h-9"
            aria-label="Savings subcategory"
            [class.missing]="!row().sub"
            (change)="onSavingsSubChange($any($event.target))"
          >
            <option value="" [selected]="!row().sub">— Goal —</option>
            @for (s of savingsSubs(); track s) {
              <option [value]="s" [selected]="row().sub === s">{{ s }}</option>
            }
            <option value="__new__">+ New goal…</option>
          </select>
          @if (!row().sub) {
            <span class="text-xs text-warning font-medium">Choose a subcategory to save</span>
          }
        } @else {
          <span class="text-xs opacity-70">Not included in spending or income totals.</span>
        }

        <div class="flex flex-wrap items-center gap-1 ml-auto">
          @if (row().needsReview && incompleteReady()) {
            <button type="button" class="btn btn-outline btn-success btn-xs" (click)="looksRight()">
              Looks right
            </button>
          }
          @if (row().splitOf) {
            <button type="button" class="btn btn-ghost btn-xs" (click)="splitRequested.emit()">
              Edit split
            </button>
            <button type="button" class="btn btn-ghost btn-xs" (click)="unsplitRequested.emit()">
              Undo split
            </button>
          } @else {
            <button type="button" class="btn btn-ghost btn-xs" (click)="splitRequested.emit()">
              Split
            </button>
          }
          <button type="button" class="btn btn-ghost btn-xs text-error" (click)="removed.emit()">
            Delete
          </button>
        </div>
      </div>
    </div>
  `,
})
export class TxRowComponent {
  readonly row = input.required<TransactionRow>();
  readonly categories = input.required<CategoryMap>();
  readonly incomeSources = input.required<string[]>();

  readonly changed = output<Partial<TransactionRow>>();
  readonly renamed = output<string>();
  readonly amountSet = output<number>();
  readonly splitRequested = output<void>();
  readonly unsplitRequested = output<void>();
  readonly removed = output<void>();
  readonly addCategoryRequested = output<void>();
  readonly addSubRequested = output<string>();

  readonly kinds = KINDS;
  readonly fmt = fmt;
  readonly prettyDate = prettyDate;
  readonly Math = Math;

  readonly editingDesc = signal(false);
  readonly descDraft = signal('');
  readonly editingAmt = signal(false);
  readonly amtDraft = signal('');

  readonly expenseCategories = computed(() =>
    Object.keys(this.categories()).filter(c => c !== 'Savings'),
  );

  readonly subs = computed(() => this.categories()[this.row().cat] || []);
  readonly savingsSubs = computed(() => this.categories()['Savings'] || []);
  readonly incompleteReady = computed(() => isComplete(this.row()));

  readonly amtText = computed(() => {
    const r = this.row();
    if (r.kind === 'income') return `+${fmt(Math.abs(r.cents))}`;
    if (r.cents < 0) return `-${fmt(-r.cents)}`;
    return fmt(r.cents);
  });

  startDescEdit(): void {
    this.descDraft.set(this.row().desc);
    this.editingDesc.set(true);
  }

  commitDesc(): void {
    if (!this.editingDesc()) return;
    const next = this.descDraft().trim();
    if (!next) return;
    this.editingDesc.set(false);
    if (next !== this.row().desc) {
      this.renamed.emit(next);
    }
  }

  cancelDesc(): void {
    this.editingDesc.set(false);
  }

  startAmtEdit(): void {
    this.amtDraft.set((Math.abs(this.row().cents) / 100).toFixed(2));
    this.editingAmt.set(true);
  }

  commitAmt(): void {
    if (!this.editingAmt()) return;
    const raw = this.amtDraft().trim();
    const parsed = parseAmount(raw);
    if (parsed === null || parsed === 0) return;
    this.editingAmt.set(false);
    const row = this.row();
    const hasMinus = /[-−]|\(.*\)|\bCR\b/i.test(raw);
    const nextCents = row.cents < 0 && !hasMinus ? -Math.abs(parsed) : parsed;
    if (nextCents !== row.cents) {
      this.amountSet.emit(nextCents);
    }
  }

  cancelAmt(): void {
    this.editingAmt.set(false);
  }

  onKindChange(nextKind: string): void {
    const kind = nextKind as TxKind;
    if (kind === 'expense') {
      const cat = this.row().cat === 'Savings' ? '' : this.row().cat;
      this.changed.emit({ kind, cat, sub: cat ? this.row().sub : '' });
    } else if (kind === 'savings') {
      const firstSub = this.savingsSubs()[0] || 'India Remittance';
      const sub = this.row().cat === 'Savings' && this.row().sub ? this.row().sub : firstSub;
      this.changed.emit({ kind, cat: 'Savings', sub });
    } else if (kind === 'income') {
      const sub = this.row().kind === 'income' ? this.row().sub : this.incomeSources()[0] || 'Salary';
      this.changed.emit({ kind, cat: '', sub });
    } else {
      this.changed.emit({ kind: 'transfer', cat: '', sub: '' });
    }
  }

  onCatChange(sel: HTMLSelectElement): void {
    if (sel.value === '__new__') {
      sel.value = this.row().cat || '';
      this.addCategoryRequested.emit();
      return;
    }
    this.changed.emit({ cat: sel.value, sub: '' });
  }

  onSubChange(sel: HTMLSelectElement): void {
    if (sel.value === '__new__') {
      sel.value = this.row().sub || '';
      if (this.row().cat) this.addSubRequested.emit(this.row().cat);
      return;
    }
    this.changed.emit({ sub: sel.value });
  }

  onIncomeSourceChange(sel: HTMLSelectElement): void {
    if (sel.value === '__new__') {
      sel.value = this.row().sub || '';
      this.addSubRequested.emit('__income__');
      return;
    }
    this.changed.emit({ sub: sel.value });
  }

  onSavingsSubChange(sel: HTMLSelectElement): void {
    if (sel.value === '__new__') {
      sel.value = this.row().sub || '';
      this.addSubRequested.emit('Savings');
      return;
    }
    this.changed.emit({ cat: 'Savings', sub: sel.value });
  }

  looksRight(): void {
    const r = this.row();
    this.changed.emit({ kind: r.kind, cat: r.cat, sub: r.sub, needsReview: false });
  }
}
