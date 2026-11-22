import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { requestPersist } from '../kit/idb';
import { ToastService } from '../kit/toast.service';
import {
  DEFAULT_CATEGORIES,
  type SplitPartInput,
  applyAmount,
  buildSplit,
  classifyAll,
  isComplete,
  learn,
  merchantOf,
} from '../domain/classify';
import { TAXONOMY, migrateData, pinMixedStores } from '../domain/migrate';
import type {
  BudgetMap,
  CategoryMap,
  CsvMapConfig,
  ImportBatch,
  RuleMap,
  TransactionRow,
  TxKind,
} from '../domain/models';
import { type ParsedCsvExport, normalizeRows, readExport } from '../domain/parse';
import { UNCATEGORIZED, monthOf, monthsPresent } from '../domain/report';
import { readWorkbook } from '../domain/workbook';
import { MoneyModalsService } from './money-modals.service';
import { type BackupPayload, MoneyStoreService } from './money-store.service';

export interface TxFilter {
  q?: string;
  month?: string;
  account?: string;
  cat?: string;
  show?: string;
  limit?: number;
}

export interface PendingWorkbookFile {
  workbook: true;
  fileName: string;
  categories: CategoryMap;
  rows: TransactionRow[];
}

export interface PendingCsvFile extends ParsedCsvExport {
  workbook?: false;
  fresh?: TransactionRow[];
  duplicates?: number;
  deletedBefore?: string[];
}

export type PendingFile = PendingWorkbookFile | PendingCsvFile;

export interface PendingEdit {
  desc: string;
  kind: TxKind;
  cat: string;
  sub: string;
}

export interface PendingImportState {
  files: PendingFile[];
  edits: Map<string, PendingEdit>;
  renames: Map<string, string>;
  amounts: Map<string, number>;
  splits: Map<string, SplitPartInput[]>;
  removed: Set<string>;
  rules: RuleMap;
  rows: TransactionRow[];
  history: TransactionRow[];
  tab: 'review' | 'all' | 'off';
}

export interface TxDraftSnapshot {
  kind: TxKind;
  cat: string;
  sub: string;
  needsReview: boolean;
  edited: boolean;
}

const withSavings = (cats: CategoryMap): CategoryMap =>
  cats['Savings'] ? cats : { ...cats, Savings: [...DEFAULT_CATEGORIES['Savings']] };

export function applyRenameToRow(row: TransactionRow, next: string): void {
  const original = row.origDesc || row.desc;
  if (row.id.startsWith('Manual|') || next === original) delete row.origDesc;
  else row.origDesc = original;
  row.desc = next;
}

@Injectable({ providedIn: 'root' })
export class MoneyStateService {
  private readonly store = inject(MoneyStoreService);
  private readonly toast = inject(ToastService);
  private readonly modals = inject(MoneyModalsService);
  private readonly router = inject(Router);

  readonly loaded = signal(false);
  readonly tx = signal<TransactionRow[]>([]);
  readonly rules = signal<RuleMap>({});
  readonly categories = signal<CategoryMap>(structuredClone(DEFAULT_CATEGORIES));
  readonly profiles = signal<CsvMapConfig[]>([]);
  readonly batches = signal<ImportBatch[]>([]);
  readonly budgets = signal<BudgetMap>({});
  readonly deleted = signal<Set<string>>(new Set());
  readonly drafts = signal<Map<string, TxDraftSnapshot>>(new Map());

  readonly scope = signal<'month' | 'year'>('month');
  readonly month = signal<string | null>(null);
  readonly year = signal<string | null>(null);
  readonly openCat = signal<string | null>(null);
  readonly filter = signal<TxFilter>({});
  readonly pending = signal<PendingImportState | null>(null);

  readonly incomeSources = computed(() => [
    ...new Set([
      'Salary',
      'Other',
      ...this.tx()
        .filter(r => r.kind === 'income' && r.sub)
        .map(r => r.sub),
    ]),
  ]);

  readonly pendingCategories = computed<CategoryMap>(() => {
    const p = this.pending();
    const wb = p?.files.find((f): f is PendingWorkbookFile => Boolean(f.workbook));
    return wb ? wb.categories : this.categories();
  });

  /** Moves saved data from v1/v2 category taxonomy to v3 once, preserving a backup copy in kv. */
  async upgradeCategories(): Promise<void> {
    const from = (await this.store.getKv<number>('taxonomy')) || 1;
    if (from >= TAXONOMY) return;
    const before = {
      tx: await this.store.allTx(),
      rules: await this.store.getKv<RuleMap>('rules'),
      categories: await this.store.getKv<CategoryMap>('categories'),
      budgets: await this.store.getKv<BudgetMap>('budgets'),
    };
    const hasData = Boolean(before.tx.length || before.categories);
    if (hasData && from < 2) {
      await this.store.setKv('beforeTaxonomy2', before);
      const after = migrateData(before);
      await this.store.putTx(after.tx);
      await this.store.setKv('rules', after.rules);
      await this.store.setKv('categories', after.categories);
      await this.store.setKv('budgets', after.budgets);
    } else if (hasData) {
      await this.store.setKv('rules', pinMixedStores(before.rules || {}));
    }
    await this.store.setKv('taxonomy', TAXONOMY);
  }

  async loadAll(): Promise<void> {
    await this.upgradeCategories();
    const allTx = await this.store.allTx();
    for (const r of allTx) if (!isComplete(r)) r.needsReview = true;
    this.tx.set(allTx);
    this.rules.set((await this.store.getKv<RuleMap>('rules')) || {});
    this.categories.set(
      withSavings((await this.store.getKv<CategoryMap>('categories')) || structuredClone(DEFAULT_CATEGORIES)),
    );
    this.profiles.set((await this.store.getKv<CsvMapConfig[]>('profiles')) || []);
    this.batches.set((await this.store.getKv<ImportBatch[]>('batches')) || []);
    this.deleted.set(new Set((await this.store.getKv<string[]>('deleted')) || []));
    this.budgets.set((await this.store.getKv<BudgetMap>('budgets')) || {});
    this.drafts.set(new Map());
    this.filter.set({});
    this.pending.set(null);
    this.month.set(null);
    this.openCat.set(null);
    this.pickDefaults();
    this.loaded.set(true);
  }

  pickDefaults(): void {
    const months = monthsPresent(this.tx());
    const curMonth = this.month();
    if (!curMonth || !months.includes(curMonth)) {
      this.month.set(months[months.length - 1] || null);
    }
    const nextMonth = this.month();
    this.year.set(nextMonth ? nextMonth.slice(0, 4) : null);
  }

  private async saveDeleted(): Promise<void> {
    await this.store.setKv('deleted', [...this.deleted()]);
  }

  async saveCategories(cats: CategoryMap): Promise<void> {
    this.categories.set(cats);
    await this.store.setKv('categories', cats);
  }

  async addCategory(name: string, usePending = false): Promise<void> {
    if (usePending) {
      const cats = this.pendingCategories();
      if (cats === this.categories()) {
        await this.saveCategories({ ...cats, [name]: [] });
      } else {
        cats[name] = [];
      }
      return;
    }
    await this.saveCategories({ ...this.categories(), [name]: [] });
  }

  async addSub(cat: string, sub: string, usePending = false): Promise<void> {
    if (usePending) {
      const cats = this.pendingCategories();
      if (cats === this.categories()) {
        await this.saveCategories({ ...cats, [cat]: [...(cats[cat] || []), sub] });
      } else {
        cats[cat] = [...(cats[cat] || []), sub];
      }
      return;
    }
    const cur = this.categories();
    await this.saveCategories({ ...cur, [cat]: [...(cur[cat] || []), sub] });
  }

  async removeCategory(name: string): Promise<void> {
    const { [name]: _dropped, ...rest } = this.categories();
    await this.saveCategories(rest);
    const b = this.budgets();
    if (b[name]) {
      const { [name]: _droppedBudget, ...nextBudgets } = b;
      this.budgets.set(nextBudgets);
      await this.store.setKv('budgets', nextBudgets);
    }
    this.toast.show(`Removed ${name}.`);
  }

  /* ---------- Import & Pending ---------- */

  private createPending(): PendingImportState {
    return {
      files: [],
      edits: new Map(),
      renames: new Map(),
      amounts: new Map(),
      splits: new Map(),
      removed: new Set(),
      rules: structuredClone(this.rules()),
      rows: [],
      history: [],
      tab: 'review',
    };
  }

  rebuildPending(source = this.pending()): void {
    if (!source) return;
    const P: PendingImportState = {
      ...source,
      files: [...source.files],
    };
    const existing = new Set(this.tx().flatMap(r => (r.splitOf ? [r.id, r.splitOf] : [r.id])));
    const rules = structuredClone(this.rules());
    for (const f of P.files) {
      if (f.workbook) f.rows.forEach(r => learn(rules, r));
    }
    for (const [id, e] of P.edits) {
      learn(rules, { id, desc: e.desc, kind: e.kind, cat: e.cat, sub: e.sub }, { manual: true });
    }
    P.rules = rules;

    const deletedSet = this.deleted();
    const bankRows: TransactionRow[] = [];
    for (const f of P.files) {
      if (f.workbook) continue;
      f.fresh = f.rows.filter(r => !existing.has(r.id) && !deletedSet.has(r.id) && !P.removed.has(r.id)) as TransactionRow[];
      f.duplicates = f.rows.filter(r => existing.has(r.id)).length;
      f.deletedBefore = f.rows.filter(r => deletedSet.has(r.id) && !existing.has(r.id)).map(r => r.id);
      bankRows.push(...f.fresh);
    }

    const cats = P.files.find((f): f is PendingWorkbookFile => Boolean(f.workbook))?.categories || this.categories();
    const classified = classifyAll(bankRows, rules, cats);
    for (const r of classified) {
      const e = P.edits.get(r.id);
      if (e) Object.assign(r, { kind: e.kind, cat: e.cat, sub: e.sub, edited: true, needsReview: !isComplete(e) });
      if (P.renames.has(r.id)) applyRenameToRow(r, P.renames.get(r.id)!);
      if (P.amounts.has(r.id)) applyAmount(r, P.amounts.get(r.id)!);
    }
    P.rows = classified
      .flatMap(r => (P.splits.has(r.id) ? buildSplit(r, P.splits.get(r.id)!) : [r]))
      .sort((a, b) => a.date.localeCompare(b.date));
    P.history = P.files
      .filter((f): f is PendingWorkbookFile => Boolean(f.workbook))
      .flatMap(f => f.rows.filter(r => !existing.has(r.id) && !deletedSet.has(r.id)));

    const needsCount = P.rows.filter(r => r.needsReview).length;
    if (!needsCount && P.tab === 'review') P.tab = 'all';
    this.pending.set(P);
  }

  async addFiles(fileList: FileList | File[]): Promise<void> {
    const files = [...fileList];
    if (!files.length) return;
    const P = this.pending() ? { ...this.pending()!, files: [...this.pending()!.files] } : this.createPending();
    void this.router.navigateByUrl('/import');

    for (const file of files) {
      try {
        if (/\.xlsx$/i.test(file.name)) {
          const { categories, rows } = await readWorkbook(await file.arrayBuffer());
          P.files.push({ workbook: true, fileName: file.name, categories, rows });
        } else if (/\.(csv|tsv|txt)$/i.test(file.name)) {
          const parsed = readExport(await file.text(), file.name, this.profiles());
          if (!parsed.dataRows.length) throw new Error('No transactions found in this file.');
          P.files.push(parsed);
        } else {
          this.toast.show(`${file.name}: only .csv and .xlsx files can be imported.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.toast.show(`${file.name}: ${msg}`);
      }
    }

    if (!P.files.length) {
      this.pending.set(null);
      return;
    }
    this.rebuildPending(P);
    const unrec = this.pending()?.files.filter((f): f is PendingCsvFile => !f.workbook && !f.recognized) || [];
    for (const f of unrec) {
      await this.modals.openMapper(f);
    }
  }

  removePendingFile(file: PendingFile): void {
    const P = this.pending();
    if (!P) return;
    const files = P.files.filter(f => f !== file);
    if (!files.length) {
      this.pending.set(null);
      return;
    }
    this.rebuildPending({ ...P, files });
  }

  discardPending(): void {
    this.pending.set(null);
  }

  setPendingTab(tab: 'review' | 'all' | 'off'): void {
    const P = this.pending();
    if (!P) return;
    this.pending.set({ ...P, tab });
  }

  async bringBackDeletedFromFile(ids: string[]): Promise<void> {
    const nextDeleted = new Set(this.deleted());
    for (const id of ids) nextDeleted.delete(id);
    this.deleted.set(nextDeleted);
    await this.saveDeleted();
    this.rebuildPending();
  }

  async rememberFormat(file: PendingCsvFile): Promise<void> {
    const profile: CsvMapConfig = {
      ...file.map,
      id: file.signature,
      custom: true,
      headers: file.signature.split('|'),
    };
    const next = [...this.profiles().filter(p => p.id !== profile.id), profile];
    this.profiles.set(next);
    await this.store.setKv('profiles', next);
  }

  reapplyMap(file: PendingCsvFile): void {
    Object.assign(file, normalizeRows(file.dataRows, file.headers, file.map), { recognized: true });
    this.rebuildPending();
  }

  async savePending(): Promise<void> {
    const P = this.pending();
    if (!P) return;
    const totalCount = P.rows.length + P.history.length;
    const ready =
      totalCount > 0 &&
      P.files.every(f => f.workbook || f.recognized) &&
      P.rows.every(isComplete);
    if (!ready) return;

    if (P.removed.size) {
      const nextDel = new Set(this.deleted());
      P.removed.forEach(id => nextDel.add(id));
      this.deleted.set(nextDel);
      await this.saveDeleted();
    }

    const batchId = `b${Date.now()}`;
    const fileNames = P.files.map(f => f.fileName);
    const rows = [...P.rows, ...P.history].map(r => ({ ...r, batch: batchId }));
    const workbook = P.files.find((f): f is PendingWorkbookFile => Boolean(f.workbook));
    if (workbook) await this.saveCategories(withSavings(workbook.categories));

    const nextRules = structuredClone(P.rules);
    for (const [id, e] of P.edits) {
      learn(nextRules, { id, desc: e.desc, kind: e.kind, cat: e.cat, sub: e.sub }, { manual: true });
    }
    for (const r of P.rows) {
      if (r.edited) continue;
      if (r.kind === 'expense' && r.cat && !r.needsReview) learn(nextRules, r);
    }

    await this.store.putTx(rows);
    this.rules.set(nextRules);
    await this.store.setKv('rules', nextRules);
    const nextBatches = [{ id: batchId, at: new Date().toISOString(), files: fileNames, count: rows.length }, ...this.batches()];
    this.batches.set(nextBatches);
    await this.store.setKv('batches', nextBatches);

    const nextTx = [...this.tx(), ...rows];
    this.tx.set(nextTx);
    requestPersist();

    const latest = P.rows.length
      ? P.rows.map(monthOf).sort().pop() ?? null
      : monthsPresent(nextTx).pop() ?? null;
    this.pending.set(null);
    this.filter.set({});
    this.month.set(latest);
    this.year.set(latest ? latest.slice(0, 4) : null);
    this.scope.set('month');
    this.openCat.set(null);
    void this.router.navigateByUrl('/');
    this.toast.show(`Saved ${rows.length} transactions.`);
  }

  /* ---------- Pending Row Actions ---------- */

  pendingChanged(row: TransactionRow, patch: Partial<TransactionRow>): void {
    const P = this.pending();
    if (!P) return;
    const updated: TransactionRow = { ...row, ...patch, edited: true };
    updated.needsReview = !isComplete(updated);

    if (updated.splitOf) {
      const parts = P.splits.get(updated.splitOf);
      if (parts && updated.splitIndex != null) {
        parts[updated.splitIndex] = { ...parts[updated.splitIndex], kind: updated.kind, cat: updated.cat, sub: updated.sub };
      }
      this.pending.set({
        ...P,
        rows: P.rows.map(r => (r.id === updated.id ? updated : r)),
      });
      return;
    }

    P.edits.set(updated.id, {
      desc: updated.origDesc || updated.desc,
      kind: updated.kind,
      cat: updated.cat,
      sub: updated.sub,
    });
    const nextRows = P.rows.map(r => (r.id === updated.id ? updated : r));
    this.pending.set({ ...P, rows: nextRows });

    this.offerApplyToOthers(updated, nextRows, others => {
      const curP = this.pending();
      if (!curP) return;
      const otherIds = new Set(others.map(o => o.id));
      const patched = curP.rows.map(r => {
        if (!otherIds.has(r.id)) return r;
        const copy: TransactionRow = { ...r, kind: updated.kind, cat: updated.cat, sub: updated.sub, needsReview: false, edited: true };
        curP.edits.set(copy.id, { desc: copy.origDesc || copy.desc, kind: copy.kind, cat: copy.cat, sub: copy.sub });
        return copy;
      });
      this.pending.set({ ...curP, rows: patched });
    });
  }

  pendingRename(row: TransactionRow, next: string): void {
    const P = this.pending();
    if (!P) return;
    if (row.splitOf && row.splitIndex != null) {
      const parts = P.splits.get(row.splitOf);
      if (parts) parts[row.splitIndex].desc = next;
    } else {
      P.renames.set(row.id, next);
    }
    const copy = { ...row };
    applyRenameToRow(copy, next);
    this.pending.set({ ...P, rows: P.rows.map(r => (r.id === copy.id ? copy : r)) });
  }

  pendingSetAmount(row: TransactionRow, cents: number): void {
    const P = this.pending();
    if (!P) return;
    P.amounts.set(row.id, cents);
    const copy = { ...row };
    applyAmount(copy, cents);
    this.pending.set({ ...P, rows: P.rows.map(r => (r.id === copy.id ? copy : r)) });
  }

  pendingRemove(row: TransactionRow): void {
    const P = this.pending();
    if (!P) return;
    P.removed.add(row.id);
    for (const f of P.files) {
      if (!f.workbook && f.fresh) f.fresh = f.fresh.filter(r => r.id !== row.id);
    }
    this.pending.set({
      ...P,
      rows: P.rows.filter(r => r.id !== row.id),
    });
    this.toast.show(`Deleted ${row.desc}.`, {
      label: 'Undo',
      run: () => {
        const cur = this.pending();
        if (!cur || !cur.removed.has(row.id)) return;
        cur.removed.delete(row.id);
        this.rebuildPending(cur);
      },
    });
  }

  pendingSplit(parent: TransactionRow, parts: SplitPartInput[]): void {
    const P = this.pending();
    if (!P) return;
    P.splits.set(parent.id, parts);
    this.rebuildPending(P);
  }

  pendingUnsplit(row: TransactionRow): void {
    const P = this.pending();
    if (!P || !row.splitOf) return;
    P.splits.delete(row.splitOf);
    this.rebuildPending(P);
  }

  /* ---------- Saved Transactions Actions ---------- */

  revertDrafts(silent = false): void {
    const map = this.drafts();
    if (!map.size) return;
    const nextTx = this.tx().map(r => {
      const snap = map.get(r.id);
      return snap ? { ...r, ...snap } : r;
    });
    this.tx.set(nextTx);
    this.drafts.set(new Map());
    if (!silent) this.toast.show('An unfinished category change was not saved.');
  }

  async txChanged(row: TransactionRow, patch: Partial<TransactionRow>): Promise<void> {
    const dMap = new Map(this.drafts());
    if (!dMap.has(row.id)) {
      dMap.set(row.id, {
        kind: row.kind,
        cat: row.cat,
        sub: row.sub,
        needsReview: row.needsReview,
        edited: row.edited,
      });
    }
    const updated: TransactionRow = { ...row, ...patch, edited: true };
    updated.needsReview = !isComplete(updated);
    const nextTx = this.tx().map(r => (r.id === updated.id ? updated : r));

    if (!isComplete(updated)) {
      this.drafts.set(dMap);
      this.tx.set(nextTx);
      return;
    }

    dMap.delete(updated.id);
    this.drafts.set(dMap);
    this.tx.set(nextTx);
    await this.store.putTx([updated]);
    if (updated.splitOf) return;

    const nextRules = structuredClone(this.rules());
    learn(nextRules, updated, { manual: true });
    this.rules.set(nextRules);
    await this.store.setKv('rules', nextRules);

    this.offerApplyToOthers(updated, this.tx(), async others => {
      const otherIds = new Set(others.map(o => o.id));
      const patchedOthers: TransactionRow[] = [];
      const list = this.tx().map(r => {
        if (!otherIds.has(r.id)) return r;
        const copy: TransactionRow = { ...r, kind: updated.kind, cat: updated.cat, sub: updated.sub, needsReview: false, edited: true };
        patchedOthers.push(copy);
        return copy;
      });
      this.tx.set(list);
      await this.store.putTx(patchedOthers);
    });
  }

  async txRename(row: TransactionRow, next: string): Promise<void> {
    const copy = { ...row };
    applyRenameToRow(copy, next);
    const snap = this.drafts().get(row.id);
    this.tx.set(this.tx().map(r => (r.id === copy.id ? copy : r)));
    await this.store.putTx([{ ...copy, ...snap }]);
    this.toast.show('Description saved.');
  }

  async txSetAmount(row: TransactionRow, cents: number): Promise<void> {
    const copy = { ...row };
    applyAmount(copy, cents);
    const snap = this.drafts().get(row.id);
    this.tx.set(this.tx().map(r => (r.id === copy.id ? copy : r)));
    await this.store.putTx([{ ...copy, ...snap }]);
    this.toast.show('Amount saved.');
  }

  async txSplit(parent: TransactionRow, parts: SplitPartInput[], previous: TransactionRow[] = []): Promise<void> {
    const children = buildSplit(parent, parts);
    const replaced = new Set([parent.id, ...previous.map(r => r.id)]);
    await this.store.deleteTx([...replaced]);
    await this.store.putTx(children);
    this.tx.set([...this.tx().filter(r => !replaced.has(r.id)), ...children]);
    const nextDrafts = new Map(this.drafts());
    replaced.forEach(id => nextDrafts.delete(id));
    this.drafts.set(nextDrafts);
    this.toast.show('Split saved.');
  }

  async txUnsplit(row: TransactionRow): Promise<void> {
    if (!row.splitOf || !row.splitParent) return;
    const parts = this.tx().filter(r => r.splitOf === row.splitOf);
    const ids = new Set(parts.map(r => r.id));
    await this.store.deleteTx([...ids]);
    await this.store.putTx([row.splitParent]);
    this.tx.set([...this.tx().filter(r => !ids.has(r.id)), row.splitParent]);
    const nextDrafts = new Map(this.drafts());
    ids.forEach(id => nextDrafts.delete(id));
    this.drafts.set(nextDrafts);
    this.toast.show('Split undone.');
  }

  async txRemove(row: TransactionRow): Promise<void> {
    const dMap = new Map(this.drafts());
    let actualRow = row;
    if (dMap.has(row.id)) {
      actualRow = { ...row, ...dMap.get(row.id)! };
      dMap.delete(row.id);
      this.drafts.set(dMap);
    }
    this.tx.set(this.tx().filter(r => r.id !== row.id));
    const nextDel = new Set(this.deleted());
    nextDel.add(row.id);
    if (row.splitOf) nextDel.add(row.splitOf);
    this.deleted.set(nextDel);
    await this.store.deleteTx([row.id]);
    await this.saveDeleted();
    this.pickDefaults();

    this.toast.show(`Deleted ${actualRow.desc}.`, {
      label: 'Undo',
      run: async () => {
        this.tx.set([...this.tx(), actualRow]);
        const del = new Set(this.deleted());
        del.delete(actualRow.id);
        this.deleted.set(del);
        await this.store.putTx([actualRow]);
        await this.saveDeleted();
        this.pickDefaults();
      },
    });
  }

  async addManualTx(row: TransactionRow): Promise<void> {
    await this.store.putTx([row]);
    this.tx.set([...this.tx(), row]);
    this.filter.set({ ...this.filter(), month: monthOf(row) });
    this.pickDefaults();
    this.toast.show(`Added ${row.desc}.`);
  }

  async saveBudgets(next: BudgetMap): Promise<void> {
    this.budgets.set(next);
    await this.store.setKv('budgets', next);
    this.toast.show('Budgets saved.');
  }

  async undoBatch(b: ImportBatch): Promise<void> {
    const rows = this.tx().filter(r => r.batch === b.id);
    await this.store.deleteTx(rows.map(r => r.id));
    this.tx.set(this.tx().filter(r => r.batch !== b.id));
    const nextBatches = this.batches().filter(x => x.id !== b.id);
    this.batches.set(nextBatches);
    await this.store.setKv('batches', nextBatches);
    this.pickDefaults();
    this.toast.show('Import removed.');
  }

  async restoreFromBackup(data: BackupPayload): Promise<void> {
    await this.store.replaceAll(data);
    await this.loadAll();
    void this.router.navigateByUrl('/');
    this.toast.show('Backup restored.');
  }

  async eraseAllData(): Promise<void> {
    await this.store.eraseAll();
    await this.loadAll();
    void this.router.navigateByUrl('/import');
    this.toast.show('Erased.');
  }

  filteredTransactions(): TransactionRow[] {
    const f = this.filter();
    const q = (f.q || '').toLowerCase();
    return this.tx()
      .filter(
        r =>
          (!f.month || r.date.startsWith(f.month)) &&
          (!f.account || r.account === f.account) &&
          (!f.cat || (r.cat || UNCATEGORIZED) === f.cat) &&
          (!q ||
            r.desc.toLowerCase().includes(q) ||
            (r.origDesc || '').toLowerCase().includes(q) ||
            (r.sub || '').toLowerCase().includes(q)) &&
          (!f.show || (f.show === 'review' ? r.needsReview : r.kind === f.show)),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || a.desc.localeCompare(b.desc));
  }

  private offerApplyToOthers(
    row: TransactionRow,
    list: TransactionRow[],
    apply: (others: TransactionRow[]) => void | Promise<void>,
  ): void {
    if (row.splitOf) return;
    const key = merchantOf(row);
    const sameMerchant = (other: string) =>
      other === key || other.startsWith(`${key} `) || key.startsWith(`${other} `);
    const others = list.filter(
      r =>
        r.id !== row.id &&
        !r.edited &&
        sameMerchant(merchantOf(r)) &&
        (r.kind !== row.kind || r.cat !== row.cat || r.sub !== row.sub),
    );
    if (!isComplete(row) || !others.length) return;
    this.toast.show(`Remembered for ${key}.`, {
      label: `Apply to ${others.length} other${others.length > 1 ? 's' : ''}`,
      run: () => {
        void apply(others);
      },
    });
  }
}
