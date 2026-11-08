// Totals for the report screens. All amounts are integer cents.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthOf = row => row.date.slice(0, 7);
export const UNCATEGORIZED = 'Uncategorized';

export function monthsPresent(rows) {
  return [...new Set(rows.filter(r => r.kind !== 'transfer').map(monthOf))].sort();
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[+m - 1]} ${y}`;
}

export function previousMonth(ym) {
  let [y, m] = ym.split('-').map(Number);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Every month from January of the earliest year through the current or latest month, newest first. */
export function monthChoices(rows, today) {
  const seen = rows.map(monthOf).sort();
  const current = today.slice(0, 7);
  const first = `${(seen[0] && seen[0] < current ? seen[0] : current).slice(0, 4)}-01`;
  const last = seen.length && seen[seen.length - 1] > current ? seen[seen.length - 1] : current;
  const out = [];
  for (let m = last; m >= first; m = previousMonth(m)) out.push(m);
  return out;
}

/** Income and expense for each month in `list`, in the same order. */
export function monthSeries(rows, list) {
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

/** Money moved to savings in each month of `list`, in the same order. */
export function monthlySavings(rows, list) {
  return list.map(m => rows.filter(r => r.kind === 'savings' && monthOf(r) === m).reduce((s, r) => s + r.cents, 0));
}

/** Each month's income as 100%: how much went to spending, to savings, and what was left. */
export function incomeSplit(rows, list) {
  const { income, expense } = monthSeries(rows, list);
  const savings = monthlySavings(rows, list);
  return list.map((_, i) => {
    const spent = Math.max(0, expense[i]);
    const saved = Math.max(0, savings[i]);
    const left = Math.max(0, income[i] - spent - saved);
    const pct = cents => (income[i] > 0 ? (cents / income[i]) * 100 : 0);
    return { income: income[i], expense: spent, savings: saved, left, expensePct: pct(spent), savingsPct: pct(saved), leftPct: pct(left) };
  });
}

/** Picks the biggest categories across all time, so each keeps its color in every period. */
export function categoryStack(rows, list, count) {
  const nameOf = r => r.cat || UNCATEGORIZED;
  const lifetime = new Map();
  for (const r of rows) if (r.kind === 'expense') lifetime.set(nameOf(r), (lifetime.get(nameOf(r)) || 0) + r.cents);
  const names = [...lifetime].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, count).map(([n]) => n);
  const at = new Map(list.map((m, i) => [m, i]));
  const values = names.map(() => list.map(() => 0));
  const other = list.map(() => 0);
  for (const r of rows) {
    const i = at.get(monthOf(r));
    if (i === undefined || r.kind !== 'expense') continue;
    const n = names.indexOf(nameOf(r));
    if (n >= 0) values[n][i] += r.cents; else other[i] += r.cents;
  }
  return { names, values, other };
}

/** Running spend by day of the month. An unfinished month stops at today. */
export function spendingPace(rows, ym, today) {
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const length = today.startsWith(ym) ? +today.slice(8, 10) : days;
  const perDay = Array(length).fill(0);
  for (const r of rows) {
    if (r.kind !== 'expense' || monthOf(r) !== ym) continue;
    const d = Math.min(+r.date.slice(8, 10), length) - 1;
    perDay[d] += r.cents;
  }
  let sum = 0;
  return perDay.map(c => (sum += c));
}

/** Largest spending groups in a period, such as merchants or subcategories. */
export function topBy(rows, prefix, keyOf, count = 8, kind = 'expense') {
  const totals = new Map();
  for (const r of rows) {
    if (r.kind !== kind || !r.date.startsWith(prefix)) continue;
    const key = keyOf(r);
    if (key) totals.set(key, (totals.get(key) || 0) + r.cents);
  }
  return [...totals].filter(([, c]) => c > 0).map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents).slice(0, count);
}

/** The middle month over the last 12 with data, so one big bill doesn't inflate the suggestion. */
export function typicalMonthly(rows) {
  const months = monthsPresent(rows).slice(-12);
  const at = new Map(months.map((m, i) => [m, i]));
  const median = list => {
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    if (!sorted.length) return 0;
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };
  const byCategory = new Map();
  const income = months.map(() => 0);
  for (const r of rows) {
    const i = at.get(monthOf(r));
    if (i === undefined) continue;
    if (r.kind === 'income') income[i] -= r.cents;
    else if (r.kind === 'expense' && r.cat) {
      if (!byCategory.has(r.cat)) byCategory.set(r.cat, months.map(() => 0));
      byCategory.get(r.cat)[i] += r.cents;
    }
  }
  return { categories: Object.fromEntries([...byCategory].map(([name, list]) => [name, Math.max(0, median(list))])), income: median(income) };
}

/** Totals across categories that have a budget. `months` is 1 for a month, or the months covered in a year. */
export function budgetSummary(categories, budgets, months = 1) {
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

/** `prefix` is a month ('2026-10') or a whole year ('2026'). */
export function periodSummary(rows, prefix) {
  const inMonth = rows.filter(r => r.date.startsWith(prefix));
  const expenses = inMonth.filter(r => r.kind === 'expense');
  const income = inMonth.filter(r => r.kind === 'income');
  const spent = expenses.reduce((s, r) => s + r.cents, 0);
  const earned = income.reduce((s, r) => s - r.cents, 0);
  // Money moved to savings isn't spending, so it stays inside "saved" (earned minus spent).
  const setAside = inMonth.filter(r => r.kind === 'savings').reduce((s, r) => s + r.cents, 0);

  const cats = new Map();
  const accounts = new Map();
  for (const r of expenses) {
    const name = r.cat || UNCATEGORIZED;
    if (!cats.has(name)) cats.set(name, { name, cents: 0, subs: new Map() });
    const c = cats.get(name);
    c.cents += r.cents;
    const sub = r.sub || '(none)';
    c.subs.set(sub, (c.subs.get(sub) || 0) + r.cents);
    accounts.set(r.account, (accounts.get(r.account) || 0) + r.cents);
  }
  return {
    spent, earned, saved: earned - spent, setAside,
    count: expenses.length,
    review: inMonth.filter(r => r.needsReview).length,
    transfers: inMonth.filter(r => r.kind === 'transfer').length,
    categories: [...cats.values()]
      .map(c => ({ ...c, subs: [...c.subs].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents) }))
      .sort((a, b) => b.cents - a.cents),
    accounts: [...accounts].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents),
  };
}

const CARD_ISSUERS = [[/\bCITI\b/i, 'Citi'], [/CAPITAL ONE/i, 'Capital One'], [/\bCHASE\b/i, 'Chase'], [/DISCOVER/i, 'Discover'], [/AMERICAN EXPRESS|\bAMEX\b/i, 'American Express']];

/** Card companies you paid this month with no export from that card, so its spending is absent. */
export function missingCards(rows, ym) {
  const inMonth = rows.filter(r => monthOf(r) === ym);
  const accounts = new Set(inMonth.filter(r => r.kind !== 'transfer' || r.cents < 0).map(r => r.account));
  const missing = new Set();
  for (const r of inMonth) {
    if (r.kind !== 'transfer' || r.cents <= 0) continue;
    for (const [pattern, name] of CARD_ISSUERS) {
      if (pattern.test(r.desc) && ![...accounts].some(a => a.toLowerCase().includes(name.toLowerCase()))) missing.add(name);
    }
  }
  return [...missing];
}

export function yearMatrix(rows, year, categories) {
  const inYear = rows.filter(r => r.date.startsWith(`${year}-`));
  const names = [...Object.keys(categories)];
  if (inYear.some(r => r.kind === 'expense' && !r.cat)) names.push(UNCATEGORIZED);
  for (const r of inYear) if (r.kind === 'expense' && r.cat && !names.includes(r.cat)) names.push(r.cat);

  const table = names.map(name => ({ name, months: Array(12).fill(0), total: 0 }));
  const byName = new Map(table.map(t => [t.name, t]));
  const expense = Array(12).fill(0);
  const income = Array(12).fill(0);
  for (const r of inYear) {
    const m = +r.date.slice(5, 7) - 1;
    if (r.kind === 'expense') {
      const t = byName.get(r.cat || UNCATEGORIZED);
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
