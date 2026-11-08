// The landing page: one set of charts for a chosen month or a whole year.

import { h, select, fmt, localToday } from './ui.js';
import { groupedBars, stackedBars, divergingBars, paceLine, rankRow } from './charts.js';
import { merchantOf } from './classify.js';
import {
  MONTH_NAMES, monthsPresent, monthLabel, previousMonth, periodSummary, monthSeries, categoryStack,
  spendingPace, topBy, yearMatrix, missingCards, UNCATEGORIZED,
} from './report.js';

const SHORT = MONTH_NAMES.map(n => n.slice(0, 3));
const INCOME = 'var(--series-income)';
const EXPENSE = 'var(--series-expense)';
const STACK_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const titleCase = text => text.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

function tile(label, value, note, id) {
  const isWord = !/\d/.test(value);
  return h('div', { class: 'tile', id }, h('span', { class: 'muted' }, label), h('b', { class: isWord ? 'word' : '' }, value), note ? h('span', { class: 'muted small-text' }, note) : false);
}

const card = (title, cls, ...body) => h('section', { class: `card ${cls}` }, h('h2', {}, title), ...body);
const empty = text => h('p', { class: 'muted' }, text);

function picker(label, list, value, describe, go, id) {
  const i = list.indexOf(value);
  return h('div', { class: 'picker' },
    h('button', { class: 'ghost icon', 'aria-label': `Earlier ${label}`, disabled: i <= 0, onclick: () => go(list[i - 1]) }, '‹'),
    select(label, value, [...list].reverse().map(v => [v, describe(v)]), go, { id }),
    h('button', { class: 'ghost icon', 'aria-label': `Later ${label}`, disabled: i >= list.length - 1, onclick: () => go(list[i + 1]) }, '›'));
}

function lastTwelve(end) {
  const out = [end];
  while (out.length < 12) out.unshift(previousMonth(out[0]));
  return out;
}

function categoryList(S, act, key, s) {
  const max = Math.max(1, ...s.categories.map(c => c.cents));
  return s.categories.map(c => {
    const open = S.openCat === c.name;
    const count = S.tx.filter(r => r.date.startsWith(key) && r.kind === 'expense' && (r.cat || UNCATEGORIZED) === c.name).length;
    return h('div', { class: 'cat' },
      rankRow({ name: c.name, cents: c.cents, max, note: s.spent ? `${Math.round((c.cents / s.spent) * 100)}%` : '', expanded: open, onClick: () => { S.openCat = open ? null : c.name; act.render(); } }),
      open && h('div', { class: 'detail' },
        c.subs.map(sub => h('div', { class: 'row between line' }, h('span', {}, sub.name), h('b', { class: 'num' }, fmt(sub.cents)))),
        h('button', { class: 'link', onclick: () => act.goTx({ month: key, cat: c.name }) }, `See or change these ${count} transactions`)));
  });
}

function rankCard(title, cls, items, none) {
  const max = Math.max(1, ...items.map(i => i.cents));
  return card(title, cls, items.length ? items.map(i => rankRow({ ...i, max })) : empty(none));
}

/** Each row is shaded against its own highest month, so rent can't wash out everything else. */
function heatTable(S, act, m) {
  const cell = (cents, rowMax) => {
    const td = h('td', { class: cents ? 'num' : 'num zero' }, cents ? fmt(cents) : '–');
    if (cents > 0 && rowMax > 0) td.style.background = `color-mix(in srgb, var(--bar) ${Math.round(6 + (cents / rowMax) * 36)}%, transparent)`;
    return td;
  };
  const plain = c => h('td', { class: c ? 'num' : 'num zero' }, c ? fmt(c) : '–');
  const openMonth = i => { S.scope = 'month'; S.month = `${S.year}-${String(i + 1).padStart(2, '0')}`; act.render(); };
  const has = i => S.tx.some(r => r.kind !== 'transfer' && r.date.startsWith(`${S.year}-${String(i + 1).padStart(2, '0')}`));
  const saved = m.income.map((v, i) => v - m.expense[i]);
  return card('Category by month', 'dash-full',
    h('p', { class: 'muted small-text' }, 'Darker cells are that category’s highest months.'),
    h('div', { class: 'scroll' }, h('table', { class: 'matrix' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Category'), SHORT.map((n, i) => h('th', { class: 'num' }, has(i) ? h('button', { class: 'link', onclick: () => openMonth(i) }, n) : n)), h('th', { class: 'num' }, 'Total'))),
      h('tbody', {}, m.table.filter(t => t.total !== 0).map(t => {
        const rowMax = Math.max(...t.months);
        return h('tr', {}, h('th', {}, t.name), t.months.map(c => cell(c, rowMax)), h('td', { class: 'num strong' }, fmt(t.total)));
      })),
      h('tfoot', {},
        h('tr', {}, h('th', {}, 'Total expense'), m.expense.map(plain), h('td', { class: 'num strong' }, fmt(m.spent))),
        h('tr', {}, h('th', {}, 'Income'), m.income.map(plain), h('td', { class: 'num strong' }, fmt(m.earned))),
        h('tr', {}, h('th', {}, 'Saved'), saved.map(plain), h('td', { class: 'num strong' }, fmt(m.earned - m.spent)))))));
}

export function viewDashboard(S, act) {
  const months = monthsPresent(S.tx);
  if (!months.length) {
    return [h('h1', {}, 'Money Manager'), h('section', { class: 'card stack' }, h('p', {}, 'No transactions yet.'), h('button', { class: 'primary', onclick: act.goImport }, 'Import your first files'))];
  }
  const years = [...new Set(months.map(m => m.slice(0, 4)))];
  if (!years.includes(S.year)) S.year = years[years.length - 1];
  const isYear = S.scope === 'year';
  const key = isYear ? S.year : S.month;
  const s = periodSummary(S.tx, key);

  const setScope = scope => {
    S.openCat = null;
    if (scope === 'year') S.year = S.month.slice(0, 4);
    else if (!S.month.startsWith(S.year)) S.month = months.filter(m => m.startsWith(S.year)).pop();
    S.scope = scope;
    act.render();
  };
  const go = field => value => { S[field] = value; S.openCat = null; act.render(); };

  const out = [h('div', { class: 'row between title dash-title' },
    h('h1', {}, 'Dashboard'),
    h('div', { class: 'row' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Period' }, [['month', 'Month'], ['year', 'Year']].map(([id, text]) =>
        h('button', { 'data-scope': id, 'aria-pressed': String(S.scope === id), onclick: () => setScope(id) }, text))),
      isYear ? picker('Year', years, S.year, y => y, go('year'), 'year') : picker('Month', months, S.month, monthLabel, go('month'), 'month')))];

  const rate = s.earned > 0 && s.saved >= 0 ? `${Math.round((s.saved / s.earned) * 100)}% of income` : null;
  if (isYear) {
    const active = new Set(S.tx.filter(r => r.kind !== 'transfer' && r.date.startsWith(key)).map(r => r.date.slice(0, 7))).size;
    out.push(h('div', { class: 'tiles' },
      tile('Total spend', fmt(s.spent), null, 'kpi-spent'),
      tile('Average per month', fmt(active ? Math.round(s.spent / active) : 0), `across ${active} month${active === 1 ? '' : 's'}`, 'kpi-average'),
      tile('Top category', s.categories[0]?.name || '–', s.categories[0] ? fmt(s.categories[0].cents) : null, 'kpi-top'),
      tile('Income', fmt(s.earned), null, 'kpi-income'),
      tile('Saved', fmt(s.saved), rate, 'kpi-saved')));
  } else {
    const prev = periodSummary(S.tx, previousMonth(S.month));
    const delta = prev.count ? s.spent - prev.spent : null;
    const prevName = MONTH_NAMES[+previousMonth(S.month).slice(5) - 1];
    out.push(h('div', { class: 'tiles' },
      tile('Spent', fmt(s.spent), delta === null ? null : `${delta > 0 ? 'up' : 'down'} ${fmt(Math.abs(delta))} from ${prevName}`, 'kpi-spent'),
      tile('Income', fmt(s.earned), null, 'kpi-income'),
      tile('Saved', fmt(s.saved), rate, 'kpi-saved'),
      tile('Transactions', String(s.count), s.transfers ? `${s.transfers} transfers left out` : null, 'kpi-count')));

    const missing = missingCards(S.tx, S.month);
    if (missing.length) out.push(h('p', { class: 'notice' }, `You paid ${missing.join(' and ')} this month, but no export from ${missing.length > 1 ? 'those cards' : 'that card'} is imported, so ${missing.length > 1 ? 'their' : 'its'} spending is missing.`));
    const realIncome = S.tx.some(r => r.kind === 'income' && r.date.startsWith(key) && r.sub !== 'Cash back');
    if (!realIncome && s.spent) out.push(h('p', { class: 'notice' }, s.earned ? 'Only cash back is recorded as income for this month.' : 'No income is recorded for this month.'));
  }
  if (s.review) out.push(h('button', { class: 'review-link', onclick: () => act.goTx({ month: key, show: 'review' }) }, `⚑ ${s.review} transaction${s.review > 1 ? 's' : ''} need a look`));

  const list = isYear ? SHORT.map((_, i) => `${S.year}-${String(i + 1).padStart(2, '0')}`) : lastTwelve(S.month);
  const labels = list.map(m => SHORT[+m.slice(5) - 1]);
  const full = list.map(monthLabel);
  const selected = isYear ? -1 : 11;
  const onPick = i => {
    if (!months.includes(list[i])) return;
    S.month = list[i]; S.scope = 'month'; S.openCat = null;
    act.render();
  };
  const series = monthSeries(S.tx, list);

  const stack = categoryStack(S.tx, list, 6);
  const stackSeries = [
    ...stack.names.map((name, i) => ({ name, color: STACK_COLORS[i], values: stack.values[i] })),
    { name: 'Other', color: 'var(--c-other)', values: stack.other },
  ];

  let third;
  if (isYear) {
    third = card('Saved each month', 'dash-chart', divergingBars({ labels, full, values: series.income.map((v, i) => v - series.expense[i]), onPick }));
  } else {
    const pace = spendingPace(S.tx, S.month, localToday());
    const before = previousMonth(S.month);
    const earlier = spendingPace(S.tx, before, localToday());
    const lines = [{ name: MONTH_NAMES[+S.month.slice(5) - 1], color: INCOME, values: pace }];
    if (earlier[earlier.length - 1] > 0) lines.push({ name: MONTH_NAMES[+before.slice(5) - 1], color: 'var(--ink-2)', dashed: true, values: earlier });
    third = card('Spending pace through the month', 'dash-chart', paceLine({ days: Math.max(...lines.map(l => l.values.length)), series: lines }));
  }

  const totalLabel = i => `Saved ${fmt(series.income[i] - series.expense[i])}`;
  const merchants = topBy(S.tx, key, r => titleCase(merchantOf(r)));
  const subs = topBy(S.tx, key, r => r.sub);

  const dash = h('div', { class: 'dash' },
    h('div', { class: 'dash-left' },
      card(isYear ? `Income and expense, ${S.year}` : 'Income and expense, last 12 months', 'o-1 dash-chart',
        groupedBars({ labels, full, selected, onPick, footer: totalLabel, series: [{ name: 'Income', color: INCOME, values: series.income }, { name: 'Expense', color: EXPENSE, values: series.expense }] })),
      card('Where the money went over time', 'o-3 dash-chart', stackedBars({ labels, full, selected, onPick, series: stackSeries })),
      Object.assign(third, { className: `${third.className} o-4` })),
    h('div', { class: 'dash-right' },
      card('By category', 'o-2', s.categories.length ? categoryList(S, act, key, s) : empty('No expenses in this period.')),
      rankCard('By account', 'o-5', s.accounts, 'No expenses in this period.')),
    rankCard('Top merchants', 'dash-half o-6', merchants, 'No expenses in this period.'),
    rankCard('Top subcategories', 'dash-half o-7', subs, 'No expenses in this period.'),
    isYear && heatTable(S, act, yearMatrix(S.tx, S.year, S.categories)));
  out.push(dash);
  return out;
}
