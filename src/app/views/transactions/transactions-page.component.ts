import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TxRowComponent } from '../../components/tx-row.component';
import { fmt } from '../../domain/format';
import type { TransactionRow } from '../../domain/models';
import { UNCATEGORIZED, monthChoices, monthLabel, monthsPresent } from '../../domain/report';
import { MoneyModalsService } from '../../services/money-modals.service';
import { MoneyStateService } from '../../services/money-state.service';

const PAGE_SIZE = 60;

@Component({
  selector: 'mm-transactions-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TxRowComponent],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h1 class="text-2xl font-bold tracking-tight">Transactions</h1>
      <button id="add-tx" type="button" class="btn btn-primary btn-sm" (click)="modals.openAddTx()">
        + Add transaction
      </button>
    </div>

    <!-- Filters -->
    <div class="card bg-base-100 border border-base-300 mb-4">
      <div class="card-body p-3 flex flex-wrap flex-row items-center gap-2">
        <input
          type="search"
          class="input input-bordered input-sm flex-1 min-w-44"
          placeholder="Search description or category…"
          aria-label="Search transactions"
          [value]="state.filter().q || ''"
          (input)="patchFilter({ q: $any($event.target).value })"
        />

        <select
          class="select select-bordered select-sm min-h-9"
          aria-label="Month"
          (change)="patchFilter({ month: $any($event.target).value })"
        >
          <option value="" [selected]="!state.filter().month">All months</option>
          @for (y of years(); track y) {
            <option [value]="y + '-'" [selected]="state.filter().month === y + '-'">All {{ y }}</option>
          }
          @for (m of months(); track m) {
            <option [value]="m" [selected]="state.filter().month === m">{{ monthLabel(m) }}</option>
          }
        </select>

        <select
          class="select select-bordered select-sm min-h-9"
          aria-label="Account"
          (change)="patchFilter({ account: $any($event.target).value })"
        >
          <option value="" [selected]="!state.filter().account">All accounts</option>
          @for (a of accounts(); track a) {
            <option [value]="a" [selected]="state.filter().account === a">{{ a }}</option>
          }
        </select>

        <select
          class="select select-bordered select-sm min-h-9"
          aria-label="Category"
          (change)="patchFilter({ cat: $any($event.target).value })"
        >
          <option value="" [selected]="!state.filter().cat">All categories</option>
          <option [value]="UNCATEGORIZED" [selected]="state.filter().cat === UNCATEGORIZED">{{ UNCATEGORIZED }}</option>
          @for (c of categoryNames(); track c) {
            <option [value]="c" [selected]="state.filter().cat === c">{{ c }}</option>
          }
        </select>

        <select
          class="select select-bordered select-sm min-h-9"
          aria-label="Show"
          (change)="patchFilter({ show: $any($event.target).value })"
        >
          <option value="" [selected]="!state.filter().show">All types</option>
          <option value="review" [selected]="state.filter().show === 'review'">Needs review</option>
          <option value="expense" [selected]="state.filter().show === 'expense'">Expenses</option>
          <option value="income" [selected]="state.filter().show === 'income'">Income</option>
          <option value="savings" [selected]="state.filter().show === 'savings'">Savings</option>
          <option value="transfer" [selected]="state.filter().show === 'transfer'">Transfers</option>
        </select>

        @if (hasFilter()) {
          <button type="button" class="btn btn-ghost btn-sm" (click)="clearFilters()">Clear</button>
        }
      </div>
    </div>

    <div id="tx-count" class="text-sm opacity-75 mb-2">{{ countSummary() }}</div>

    <div id="tx-list" class="flex flex-col gap-2">
      @for (r of visibleRows(); track r.id) {
        <mm-tx-row
          [row]="r"
          [categories]="state.categories()"
          [incomeSources]="state.incomeSources()"
          (changed)="state.txChanged(r, $event)"
          (renamed)="state.txRename(r, $event)"
          (amountSet)="state.txSetAmount(r, $event)"
          (removed)="state.txRemove(r)"
          (splitRequested)="openSplit(r)"
          (unsplitRequested)="state.txUnsplit(r)"
          (addCategoryRequested)="askNewCategory(r)"
          (addSubRequested)="askNewSub(r, $event)"
        />
      }
    </div>

    @if (visibleRows().length < filtered().length) {
      <div class="flex justify-center mt-4">
        <button type="button" class="btn btn-outline btn-sm" (click)="showMore()">
          Show more ({{ filtered().length - visibleRows().length }} left)
        </button>
      </div>
    }
  `,
})
export class TransactionsPageComponent {
  readonly state = inject(MoneyStateService);
  readonly modals = inject(MoneyModalsService);

  readonly monthLabel = monthLabel;
  readonly UNCATEGORIZED = UNCATEGORIZED;
  readonly limit = signal(PAGE_SIZE);

  readonly months = computed(() => {
    const present = monthsPresent(this.state.tx());
    const last = present[present.length - 1] || new Date().toISOString().slice(0, 7);
    const choices = monthChoices(this.state.tx(), `${last}-28`);
    return choices.length ? choices : present.reverse();
  });
  readonly years = computed(() => [...new Set(this.months().map(m => m.slice(0, 4)))]);
  readonly accounts = computed(() => [...new Set(this.state.tx().map(r => r.account))].sort());
  readonly categoryNames = computed(() =>
    Object.keys(this.state.categories()).filter(c => c !== 'Savings'),
  );

  readonly hasFilter = computed(() => {
    const f = this.state.filter();
    return Boolean(f.q || f.month || f.account || f.cat || f.show);
  });

  readonly filtered = computed(() => this.state.filteredTransactions());
  readonly visibleRows = computed(() => this.filtered().slice(0, this.limit()));
  readonly countSummary = computed(() => {
    const rows = this.filtered();
    if (!rows.length) return 'No matching transactions';
    const f = this.state.filter();
    if (f.show === 'savings') {
      const sum = rows.reduce((s, r) => s + r.cents, 0);
      return `${rows.length} shown · ${fmt(sum)} savings`;
    }
    const spent = rows.filter(r => r.kind === 'expense').reduce((s, r) => s + r.cents, 0);
    return spent > 0 ? `${rows.length} shown · ${fmt(spent)} spent` : `${rows.length} shown`;
  });

  patchFilter(patch: Record<string, string>): void {
    this.limit.set(PAGE_SIZE);
    this.state.filter.set({ ...this.state.filter(), ...patch });
  }

  clearFilters(): void {
    this.limit.set(PAGE_SIZE);
    this.state.filter.set({});
  }

  showMore(): void {
    this.limit.update(n => n + PAGE_SIZE);
  }

  async openSplit(row: TransactionRow): Promise<void> {
    const parent = row.splitParent || row;
    const siblings = row.splitOf ? this.state.tx().filter(x => x.splitOf === row.splitOf) : [];
    await this.modals.openSplit({
      parent,
      siblings,
      isPending: false,
      onSave: (parts, previous) => this.state.txSplit(parent, parts, previous),
    });
  }

  async askNewCategory(row: TransactionRow): Promise<void> {
    const name = await this.modals.askText('New category', { label: 'Category name', action: 'Add' });
    if (!name) return;
    await this.state.addCategory(name);
    await this.state.txChanged(row, { kind: 'expense', cat: name, sub: '' });
  }

  async askNewSub(row: TransactionRow, catOrIncome: string): Promise<void> {
    if (catOrIncome === '__income__') {
      const name = await this.modals.askText('New income source', { label: 'Source name', action: 'Add' });
      if (!name) return;
      await this.state.txChanged(row, { kind: 'income', cat: '', sub: name });
      return;
    }
    const name = await this.modals.askText(`New subcategory in ${catOrIncome}`, {
      label: 'Subcategory name',
      action: 'Add',
    });
    if (!name) return;
    await this.state.addSub(catOrIncome, name);
    await this.state.txChanged(row, {
      kind: catOrIncome === 'Savings' ? 'savings' : 'expense',
      cat: catOrIncome,
      sub: name,
    });
  }
}
