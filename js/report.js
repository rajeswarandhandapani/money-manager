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

export function monthSummary(rows, ym) {
  const inMonth = rows.filter(r => monthOf(r) === ym);
  const expenses = inMonth.filter(r => r.kind === 'expense');
  const income = inMonth.filter(r => r.kind === 'income');
  const spent = expenses.reduce((s, r) => s + r.cents, 0);
  const earned = income.reduce((s, r) => s - r.cents, 0);

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
    ym, spent, earned, saved: earned - spent,
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
