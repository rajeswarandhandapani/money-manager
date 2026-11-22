// Totals for the report screens. All amounts are integer cents.

import type { BudgetMap, CategoryMap, TransactionRow, TxKind } from './models';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const monthOf = (row: { date: string }): string => row.date.slice(0, 7);
export const UNCATEGORIZED = 'Uncategorized';

export function monthsPresent(rows: Array<{ date: string; kind: TxKind | string }>): string[] {
  return [...new Set(rows.filter(r => r.kind !== 'transfer').map(monthOf))].sort();
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[+m - 1]} ${y}`;
}

export function previousMonth(ym: string): string {
  let [y, m] = ym.split('-').map(Number);
  m -= 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function monthChoices(rows: Array<{ date: string }>, today: string): string[] {
  const seen = rows.map(monthOf).sort();
  const current = today.slice(0, 7);
  const first = `${(seen[0] && seen[0] < current ? seen[0] : current).slice(0, 4)}-01`;
  const last = seen.length && seen[seen.length - 1] > current ? seen[seen.length - 1] : current;
  const out: string[] = [];
  for (let m = last; m >= first; m = previousMonth(m)) out.push(m);
  return out;
}

export function monthSeries(
  rows: Array<Pick<TransactionRow, 'date' | 'kind' | 'cents'>>,
  list: string[],
): { income: number[]; expense: number[] } {
  const at = new Map(list.map((m, i) => [m, i]));
  const income = list.map(() => 0);
  const expense = list.map(() => 0);
  for (const r of rows) {
    const i = at.get(monthOf(r));
    if (i === undefined) continue;
    if (r.kind === 'expense') expense[i] += r.cents;
    else if (r.kind === 'income') income[i] -= r.cents;
  }
  return { income, expense };
}

export function monthlySavings(
  rows: Array<Pick<TransactionRow, 'date' | 'kind' | 'cents'>>,
  list: string[],
): number[] {
  return list.map(m =>
    rows.filter(r => r.kind === 'savings' && monthOf(r) === m).reduce((s, r) => s + r.cents, 0),
  );
}

export function incomeSplit(
  rows: Array<Pick<TransactionRow, 'date' | 'kind' | 'cents'>>,
  list: string[],
): Array<{
  income: number;
  expense: number;
  savings: number;
  left: number;
  expensePct: number;
  savingsPct: number;
  leftPct: number;
}> {
  const { income, expense } = monthSeries(rows, list);
  const savings = monthlySavings(rows, list);
  return list.map((_, i) => {
    const spent = Math.max(0, expense[i]);
    const saved = Math.max(0, savings[i]);
    const left = Math.max(0, income[i] - spent - saved);
    const pct = (cents: number) => (income[i] > 0 ? (cents / income[i]) * 100 : 0);
    return {
      income: income[i],
      expense: spent,
      savings: saved,
      left,
      expensePct: pct(spent),
      savingsPct: pct(saved),
      leftPct: pct(left),
    };
  });
}

export function categoryStack(
  rows: Array<Pick<TransactionRow, 'date' | 'kind' | 'cents' | 'cat'>>,
  list: string[],
  count: number,
): { names: string[]; values: number[][]; other: number[] } {
  const nameOf = (r: { cat?: string }) => r.cat || UNCATEGORIZED;
  const lifetime = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === 'expense') lifetime.set(nameOf(r), (lifetime.get(nameOf(r)) || 0) + r.cents);
  }
  const names = [...lifetime]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([n]) => n);
  const at = new Map(list.map((m, i) => [m, i]));
  const values = names.map(() => list.map(() => 0));
  const other = list.map(() => 0);
  for (const r of rows) {
    const i = at.get(monthOf(r));
    if (i === undefined || r.kind !== 'expense') continue;
    const n = names.indexOf(nameOf(r));
    if (n >= 0) values[n][i] += r.cents;
    else other[i] += r.cents;
  }
  return { names, values, other };
}

export function spendingPace(
  rows: Array<Pick<TransactionRow, 'date' | 'kind' | 'cents'>>,
  ym: string,
  today: string,
): number[] {
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const length = today.startsWith(ym) ? +today.slice(8, 10) : days;
  const perDay = Array<number>(length).fill(0);
  for (const r of rows) {
    if (r.kind !== 'expense' || monthOf(r) !== ym) continue;
    const d = Math.min(+r.date.slice(8, 10), length) - 1;
    perDay[d] += r.cents;
  }
  let sum = 0;
  return perDay.map(c => (sum += c));
}

export function topBy<T extends Pick<TransactionRow, 'date' | 'kind' | 'cents'>>(
  rows: T[],
  prefix: string,
  keyOf: (r: T) => string,
  count = 8,
  kind: TxKind = 'expense',
): Array<{ name: string; cents: number }> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== kind || !r.date.startsWith(prefix)) continue;
    const key = keyOf(r);
    if (key) totals.set(key, (totals.get(key) || 0) + r.cents);
  }
  return [...totals]
    .filter(([, c]) => c > 0)
    .map(([name, cents]) => ({ name, cents }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, count);
}

export function typicalMonthly(
  rows: Array<Pick<TransactionRow, 'date' | 'kind' | 'cents' | 'cat'>>,
): { categories: Record<string, number>; income: number } {
  const months = monthsPresent(rows).slice(-12);
  const at = new Map(months.map((m, i) => [m, i]));
  const median = (list: number[]) => {
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    if (!sorted.length) return 0;
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };
  const byCategory = new Map<string, number[]>();
  const income = months.map(() => 0);
  for (const r of rows) {
    const i = at.get(monthOf(r));
    if (i === undefined) continue;
    if (r.kind === 'income') income[i] -= r.cents;
    else if (r.kind === 'expense' && r.cat) {
      if (!byCategory.has(r.cat)) byCategory.set(r.cat, months.map(() => 0));
      byCategory.get(r.cat)![i] += r.cents;
    }
  }
  return {
    categories: Object.fromEntries([...byCategory].map(([name, list]) => [name, Math.max(0, median(list))])),
    income: median(income),
  };
}

export function budgetSummary(
  categories: Array<{ name: string; cents: number }>,
  budgets: BudgetMap,
  months = 1,
): { budgeted: number; spent: number; left: number; overCount: number } {
  let budgeted = 0;
  let spent = 0;
  let overCount = 0;
  for (const [name, monthly] of Object.entries(budgets)) {
    if (monthly <= 0) continue;
    const target = monthly * months;
    const cents = categories.find(c => c.name === name)?.cents || 0;
    budgeted += target;
    spent += cents;
    if (cents > target) overCount++;
  }
  return { budgeted, spent, left: budgeted - spent, overCount };
}

export interface CategorySummary {
  name: string;
  cents: number;
  subs: Array<{ name: string; cents: number }>;
}

export interface PeriodSummary {
  spent: number;
  earned: number;
  saved: number;
  setAside: number;
  count: number;
  review: number;
  transfers: number;
  categories: CategorySummary[];
  accounts: Array<{ name: string; cents: number }>;
}

export function periodSummary(rows: TransactionRow[], prefix: string): PeriodSummary {
  const inMonth = rows.filter(r => r.date.startsWith(prefix));
  const expenses = inMonth.filter(r => r.kind === 'expense');
  const income = inMonth.filter(r => r.kind === 'income');
  const spent = expenses.reduce((s, r) => s + r.cents, 0);
  const earned = income.reduce((s, r) => s - r.cents, 0);
  const setAside = inMonth.filter(r => r.kind === 'savings').reduce((s, r) => s + r.cents, 0);

  const cats = new Map<string, { name: string; cents: number; subs: Map<string, number> }>();
  const accounts = new Map<string, number>();
  for (const r of expenses) {
    const name = r.cat || UNCATEGORIZED;
    if (!cats.has(name)) cats.set(name, { name, cents: 0, subs: new Map() });
    const c = cats.get(name)!;
    c.cents += r.cents;
    const sub = r.sub || '(none)';
    c.subs.set(sub, (c.subs.get(sub) || 0) + r.cents);
    accounts.set(r.account, (accounts.get(r.account) || 0) + r.cents);
  }
  return {
    spent,
    earned,
    saved: earned - spent,
    setAside,
    count: expenses.length,
    review: inMonth.filter(r => r.needsReview).length,
    transfers: inMonth.filter(r => r.kind === 'transfer').length,
    categories: [...cats.values()]
      .map(c => ({
        name: c.name,
        cents: c.cents,
        subs: [...c.subs].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
      }))
      .sort((a, b) => b.cents - a.cents),
    accounts: [...accounts].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
  };
}

const CARD_ISSUERS: ReadonlyArray<[RegExp, string]> = [
  [/\bCITI\b/i, 'Citi'],
  [/CAPITAL ONE/i, 'Capital One'],
  [/\bCHASE\b/i, 'Chase'],
  [/DISCOVER/i, 'Discover'],
  [/AMERICAN EXPRESS|\bAMEX\b/i, 'American Express'],
];

export function missingCards(
  rows: Array<Pick<TransactionRow, 'date' | 'kind' | 'cents' | 'desc' | 'account'>>,
  ym: string,
): string[] {
  const inMonth = rows.filter(r => monthOf(r) === ym);
  const accounts = new Set(inMonth.filter(r => r.kind !== 'transfer' || r.cents < 0).map(r => r.account));
  const missing = new Set<string>();
  for (const r of inMonth) {
    if (r.kind !== 'transfer' || r.cents <= 0) continue;
    for (const [pattern, name] of CARD_ISSUERS) {
      if (pattern.test(r.desc) && ![...accounts].some(a => a.toLowerCase().includes(name.toLowerCase()))) {
        missing.add(name);
      }
    }
  }
  return [...missing];
}

export function yearMatrix(
  rows: Array<Pick<TransactionRow, 'date' | 'kind' | 'cents' | 'cat'>>,
  year: string,
  categories: CategoryMap,
) {
  const inYear = rows.filter(r => r.date.startsWith(`${year}-`));
  const names = [...Object.keys(categories)];
  if (inYear.some(r => r.kind === 'expense' && !r.cat)) names.push(UNCATEGORIZED);
  for (const r of inYear) if (r.kind === 'expense' && r.cat && !names.includes(r.cat)) names.push(r.cat);

  const table = names.map(name => ({ name, months: Array<number>(12).fill(0), total: 0 }));
  const byName = new Map(table.map(t => [t.name, t]));
  const expense = Array<number>(12).fill(0);
  const income = Array<number>(12).fill(0);
  for (const r of inYear) {
    const m = +r.date.slice(5, 7) - 1;
    if (r.kind === 'expense') {
      const t = byName.get(r.cat || UNCATEGORIZED)!;
      t.months[m] += r.cents;
      t.total += r.cents;
      expense[m] += r.cents;
    } else if (r.kind === 'income') {
      income[m] -= r.cents;
    }
  }
  const active = expense.filter((c, i) => c !== 0 || income[i] !== 0).length;
  const spent = expense.reduce((a, b) => a + b, 0);
  return { year, table, expense, income, spent, earned: income.reduce((a, b) => a + b, 0), active };
}
