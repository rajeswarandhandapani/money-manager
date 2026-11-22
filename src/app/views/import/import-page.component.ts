import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TxRowComponent } from '../../components/tx-row.component';
import { isComplete } from '../../domain/classify';
import { fmt } from '../../domain/format';
import type { TransactionRow } from '../../domain/models';
import { looksFlipped } from '../../domain/parse';
import { MoneyModalsService } from '../../services/money-modals.service';
import { type PendingCsvFile, MoneyStateService } from '../../services/money-state.service';

@Component({
  selector: 'mm-import-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TxRowComponent],
  template: `
    <h1 class="text-2xl font-bold tracking-tight mb-1">Import statements</h1>
    <p class="text-sm opacity-75 mb-4">
      Drop CSV exports from your bank or credit cards, or an .xlsx workbook. Everything stays offline on this device.
    </p>

    <div
      id="drop"
      role="button"
      tabindex="0"
      class="drop border-2 border-dashed border-base-300 bg-base-100 rounded-xl p-8 text-center cursor-pointer hover:border-primary transition-colors mb-4"
      (click)="fileInput.click()"
      (keydown.enter)="fileInput.click()"
      (keydown.space)="$event.preventDefault(); fileInput.click()"
      (dragover)="$event.preventDefault()"
      (drop)="onDrop($event)"
    >
      <input
        #fileInput
        id="file-input"
        type="file"
        multiple
        accept=".csv,.tsv,.txt,.xlsx"
        class="hidden"
        (change)="onFilesSelected($event)"
      />
      <p class="font-semibold text-base">Drop bank CSV or .xlsx files here, or click to choose</p>
      <p class="text-xs opacity-70 mt-1">PNC, Chase, Capital One, and any custom CSV layout supported</p>
    </div>

    @if (state.pending(); as P) {
      <!-- Uploaded Files -->
      <div class="files grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        @for (f of P.files; track f.fileName + $index) {
          <div class="card bg-base-100 border border-base-300">
            <div class="card-body p-3 gap-2">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="font-semibold text-sm truncate">{{ f.fileName }}</div>
                  @if (f.workbook) {
                    <div class="text-xs opacity-75">{{ f.rows.length }} workbook rows</div>
                  } @else {
                    <div class="text-xs opacity-75">
                      {{ f.map.account }} ·
                      @if ((f.fresh?.length ?? f.rows.length) === 0) {
                        No new rows
                      } @else {
                        {{ f.fresh?.length ?? f.rows.length }} new
                      }
                      @if ((f.duplicates || 0) > 0) {
                        · {{ f.duplicates }} already imported
                      }
                      @if (f.deletedBefore?.length) {
                        · {{ f.deletedBefore!.length }} you deleted earlier
                      }
                      @if (f.problems.length > 0) {
                        · {{ f.problems.length }} skipped line{{ f.problems.length === 1 ? '' : 's' }}
                      }
                    </div>
                  }
                </div>
                <button type="button" class="btn btn-ghost btn-xs text-error" (click)="state.removePendingFile(f)">
                  Remove
                </button>
              </div>

              @if (!f.workbook) {
                <div class="flex flex-wrap gap-2 items-center">
                  @if (!f.recognized) {
                    <span class="badge badge-warning badge-sm">Needs column mapping</span>
                  }
                  @if (isLikelyFlipped(f)) {
                    <span class="badge badge-warning badge-sm">Amounts look reversed</span>
                  }
                  <button type="button" class="btn btn-ghost btn-xs" (click)="flipSign(f)">Flip the sign</button>
                  <button type="button" class="btn btn-ghost btn-xs" (click)="modals.openMapper(f)">
                    Fix columns
                  </button>
                  @if (f.deletedBefore?.length) {
                    <button
                      type="button"
                      class="btn btn-outline btn-xs"
                      (click)="state.bringBackDeletedFromFile(f.deletedBefore!)"
                    >
                      Bring back
                    </button>
                  }
                </div>
              }
            </div>
          </div>
        }
      </div>

      <!-- Review Tabs -->
      <div class="flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Import filter">
        <button
          type="button"
          role="tab"
          data-tab="review"
          class="btn btn-sm"
          [class.btn-primary]="P.tab === 'review'"
          [class.btn-ghost]="P.tab !== 'review'"
          (click)="state.setPendingTab('review')"
        >
          Needs review ({{ needsCount() }})
        </button>
        <button
          type="button"
          role="tab"
          data-tab="all"
          class="btn btn-sm"
          [class.btn-primary]="P.tab === 'all'"
          [class.btn-ghost]="P.tab !== 'all'"
          (click)="state.setPendingTab('all')"
        >
          All ({{ P.rows.length }})
        </button>
        <button
          type="button"
          role="tab"
          data-tab="off"
          class="btn btn-sm"
          [class.btn-primary]="P.tab === 'off'"
          [class.btn-ghost]="P.tab !== 'off'"
          (click)="state.setPendingTab('off')"
        >
          Transfers ({{ offCount() }})
        </button>
      </div>

      <!-- Pending Transaction Rows -->
      <div id="review-list" class="flex flex-col gap-2 mb-4">
        @for (r of visiblePending(); track r.id) {
          <mm-tx-row
            [row]="r"
            [categories]="state.pendingCategories()"
            [incomeSources]="state.incomeSources()"
            (changed)="state.pendingChanged(r, $event)"
            (renamed)="state.pendingRename(r, $event)"
            (amountSet)="state.pendingSetAmount(r, $event)"
            (removed)="state.pendingRemove(r)"
            (splitRequested)="openPendingSplit(r)"
            (unsplitRequested)="state.pendingUnsplit(r)"
            (addCategoryRequested)="askPendingCategory(r)"
            (addSubRequested)="askPendingSub(r, $event)"
          />
        }
        @if (!visiblePending().length) {
          <div class="card bg-base-100 border border-base-300">
            <div class="card-body p-4 text-sm opacity-75 text-center">
              @if (P.tab === 'review') {
                Everything in this batch has a category. Switch to All to review every row.
              } @else {
                No transactions in this tab.
              }
            </div>
          </div>
        }
      </div>

      <!-- Sticky Save Bar -->
      <div class="savebar card bg-base-100 border border-base-300 shadow-lg">
        <div class="card-body p-3 flex flex-wrap flex-row items-center justify-between gap-3">
          <div class="flex flex-col">
            <span id="save-total" class="font-semibold text-sm">
              {{ P.rows.length + P.history.length }} transaction{{ P.rows.length + P.history.length === 1 ? '' : 's' }}
              · {{ fmt(spendingTotalCents()) }} spending
            </span>
            <span id="save-summary" class="text-xs opacity-75">
              @if (incompleteCount() > 0) {
                {{ incompleteCount() }} still need a category or subcategory
              } @else if (unrecognizedCount() > 0) {
                Finish mapping unknown files before saving
              } @else {
                Ready to save to your device
              }
            </span>
          </div>

          <div class="flex gap-2 ml-auto">
            <button type="button" class="btn btn-ghost btn-sm" (click)="state.discardPending()">Discard</button>
            <button
              id="save-import"
              type="button"
              class="btn btn-primary btn-sm"
              [disabled]="!canSave()"
              (click)="state.savePending()"
            >
              Save import
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ImportPageComponent {
  readonly state = inject(MoneyStateService);
  readonly modals = inject(MoneyModalsService);
  readonly fmt = fmt;

  readonly spendingTotalCents = computed(() => {
    const P = this.state.pending();
    if (!P) return 0;
    return [...P.rows, ...P.history]
      .filter(r => r.kind === 'expense')
      .reduce((s, r) => s + r.cents, 0);
  });

  readonly needsCount = computed(
    () => this.state.pending()?.rows.filter(r => r.needsReview).length || 0,
  );
  readonly offCount = computed(
    () => this.state.pending()?.rows.filter(r => r.kind === 'transfer').length || 0,
  );
  readonly incompleteCount = computed(
    () => this.state.pending()?.rows.filter(r => !isComplete(r)).length || 0,
  );
  readonly unrecognizedCount = computed(
    () => this.state.pending()?.files.filter(f => !f.workbook && !f.recognized).length || 0,
  );
  readonly canSave = computed(() => {
    const P = this.state.pending();
    if (!P) return false;
    return (
      P.rows.length + P.history.length > 0 &&
      this.incompleteCount() === 0 &&
      this.unrecognizedCount() === 0
    );
  });

  readonly visiblePending = computed(() => {
    const P = this.state.pending();
    if (!P) return [];
    if (P.tab === 'review') return P.rows.filter(r => r.needsReview);
    if (P.tab === 'off') return P.rows.filter(r => r.kind === 'transfer');
    return P.rows;
  });

  onFilesSelected(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) void this.state.addFiles(input.files);
    input.value = '';
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) void this.state.addFiles(e.dataTransfer.files);
  }

  isLikelyFlipped(f: PendingCsvFile): boolean {
    return looksFlipped(f.fresh || f.rows, f.map.accountType);
  }

  flipSign(f: PendingCsvFile): void {
    f.map.spendSign = (f.map.spendSign ?? -1) * -1;
    for (const r of f.rows) r.cents = -r.cents;
    this.state.reapplyMap(f);
  }

  async openPendingSplit(row: TransactionRow): Promise<void> {
    const P = this.state.pending();
    if (!P) return;
    const parent = row.splitParent || row;
    const siblings = row.splitOf ? P.rows.filter(x => x.splitOf === row.splitOf) : [];
    await this.modals.openSplit({
      parent,
      siblings,
      isPending: true,
      onSave: async parts => {
        this.state.pendingSplit(parent, parts);
      },
    });
  }

  async askPendingCategory(row: TransactionRow): Promise<void> {
    const name = await this.modals.askText('New category', { label: 'Category name', action: 'Add' });
    if (!name) return;
    await this.state.addCategory(name, true);
    this.state.pendingChanged(row, { kind: 'expense', cat: name, sub: '' });
  }

  async askPendingSub(row: TransactionRow, catOrIncome: string): Promise<void> {
    if (catOrIncome === '__income__') {
      const name = await this.modals.askText('New income source', { label: 'Source name', action: 'Add' });
      if (!name) return;
      this.state.pendingChanged(row, { kind: 'income', cat: '', sub: name });
      return;
    }
    const name = await this.modals.askText(`New subcategory in ${catOrIncome}`, {
      label: 'Subcategory name',
      action: 'Add',
    });
    if (!name) return;
    await this.state.addSub(catOrIncome, name, true);
    this.state.pendingChanged(row, {
      kind: catOrIncome === 'Savings' ? 'savings' : 'expense',
      cat: catOrIncome,
      sub: name,
    });
  }
}
