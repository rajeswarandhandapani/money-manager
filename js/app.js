import { readExport, normalizeRows, looksFlipped } from './parse.js';
import { classifyAll, learn, merchantKey, isComplete, DEFAULT_CATEGORIES } from './classify.js';
import { MONTH_NAMES, monthOf, monthsPresent, monthLabel, previousMonth, monthSummary, yearMatrix, missingCards, UNCATEGORIZED } from './report.js';
import { readWorkbook } from './workbook.js';
import * as store from './store.js';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmt = cents => money.format(cents / 100);
const fmtShort = cents => Math.abs(cents) >= 100000 ? `$${(cents / 100000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(cents / 100)}`;
const prettyDate = iso => `${MONTH_NAMES[+iso.slice(5, 7) - 1].slice(0, 3)} ${+iso.slice(8)}, ${iso.slice(0, 4)}`;

const S = { tx: [], rules: {}, categories: DEFAULT_CATEGORIES, profiles: [], batches: [], deleted: new Set(), drafts: new Map(), view: 'report', month: null, year: null, pending: null, filter: {}, openCat: null };
const saveDeleted = () => store.setKv('deleted', [...S.deleted]);
const main = document.querySelector('#main');

/** Builds DOM safely: bank text only ever becomes text nodes, never HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

let toastTimer;
function toast(message, action) {
  const box = document.querySelector('#toast');
  box.replaceChildren(h('span', {}, message));
  if (action) {
    box.append(h('button', { class: 'link', onclick: () => { box.classList.remove('show'); action.run(); } }, action.label));
  }
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), action ? 9000 : 3500);
}

function dialog(build) {
  return new Promise(resolve => {
    const d = h('dialog', {});
    const close = value => { d.close(); d.remove(); resolve(value); };
    d.append(build(close));
    d.addEventListener('cancel', e => { e.preventDefault(); close(null); });
    document.body.append(d);
    d.showModal();
  });
}

const askText = (title, { label = '', type = 'text', action = 'OK', note = '' } = {}) => dialog(close => {
  const input = h('input', { type, 'aria-label': label || title, required: true, autocomplete: 'off' });
  return h('form', { method: 'dialog', class: 'stack', onsubmit: e => { e.preventDefault(); if (input.value.trim()) close(input.value.trim()); } },
    h('h2', {}, title), label && h('label', { class: 'field' }, label), input, note && h('p', { class: 'muted' }, note),
    h('div', { class: 'row end' }, h('button', { type: 'button', class: 'ghost', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'primary' }, action)));
});

const confirmIt = (title, body, action, danger = true) => dialog(close => h('div', { class: 'stack' },
  h('h2', {}, title), h('p', {}, body),
  h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => close(false) }, 'Cancel'), h('button', { class: danger ? 'danger' : 'primary', onclick: () => close(true) }, action))));

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function saveCategories(cats) {
  S.categories = cats;
  await store.setKv('categories', cats);
}

/* ---------- One transaction, with its type and category controls ---------- */

const NEW = '__new';
function incomeSources() {
  return [...new Set(['Salary', 'Other', ...S.tx.filter(r => r.kind === 'income' && r.sub).map(r => r.sub)])];
}

function select(label, value, options, onchange, extra = {}) {
  const el = h('select', { 'aria-label': label, ...extra, onchange: () => onchange(el.value) },
    options.map(o => {
      const [v, text] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, selected: v === value }, text);
    }));
  return el;
}

function amountText(row) {
  if (row.kind === 'income') return `+${fmt(-row.cents)}`;
  if (row.cents < 0) return `−${fmt(-row.cents)}`;
  return fmt(row.cents);
}

function txRow(row, ctx) {
  const redraw = () => {
    const old = ctx.els.get(row.id);
    const fresh = txRow(row, ctx);
    if (old?.isConnected) old.replaceWith(fresh);
  };
  const commit = patch => {
    ctx.beforeChange?.(row);
    Object.assign(row, patch, { edited: true });
    row.needsReview = !isComplete(row);
    redraw();
    ctx.changed(row);
  };
  const changeKind = kind => {
    if (kind === 'income') commit({ kind, cat: 'Income', sub: row.kind === 'income' ? row.sub : 'Other' });
    else if (kind === 'transfer') commit({ kind, cat: '', sub: '' });
    else commit({ kind, cat: '', sub: '' });
  };
  const changeCat = async value => {
    let cat = value;
    if (value === NEW) {
      cat = await askText('New category');
      if (!cat) return redraw();
      if (!ctx.categories()[cat]) await ctx.addCategory(cat);
    }
    const subs = ctx.categories()[cat] || [];
    commit({ cat, sub: subs.length === 1 ? subs[0] : '' });
  };
  const changeSub = async value => {
    let sub = value;
    if (value === NEW) {
      sub = await askText(row.kind === 'income' ? 'New income source' : `New subcategory of ${row.cat}`);
      if (!sub) return redraw();
      if (row.kind === 'expense') await ctx.addSub(row.cat, sub);
    }
    commit({ sub });
  };

  const cats = ctx.categories();
  const controls = [select('Type', row.kind, [['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Not counted']], changeKind, { class: 'kind' })];
  if (row.kind === 'expense') {
    controls.push(select('Category', row.cat, [['', 'Choose category…'], ...Object.keys(cats), ...(row.cat && !cats[row.cat] ? [row.cat] : []), [NEW, '+ New category…']], changeCat, { class: row.cat ? '' : 'missing' }));
    const subs = cats[row.cat] || [];
    controls.push(select('Subcategory', row.sub, [['', row.cat ? 'Choose subcategory…' : '—'], ...subs, ...(row.sub && !subs.includes(row.sub) ? [row.sub] : []), ...(row.cat ? [[NEW, '+ New subcategory…']] : [])], changeSub, { disabled: !row.cat, class: row.cat && !row.sub ? 'missing' : '' }));
  } else if (row.kind === 'income') {
    const sources = incomeSources();
    controls.push(select('Income source', row.sub, [...sources, ...(sources.includes(row.sub) ? [] : [row.sub]), [NEW, '+ New source…']], changeSub));
  } else {
    controls.push(h('span', { class: 'muted not-counted' }, 'Left out of all totals'));
  }

  const canConfirm = row.needsReview && isComplete(row);
  const el = h('article', { class: `tx${row.needsReview ? ' review' : ''}${row.kind === 'transfer' ? ' off' : ''}` },
    h('div', { class: 'tx-head' },
      h('div', { class: 'tx-desc' },
        h('strong', {}, row.desc),
        h('span', { class: 'muted' }, [prettyDate(row.date), row.account, row.bankCategory && `bank says: ${row.bankCategory}`].filter(Boolean).join(' · '))),
      h('div', { class: `tx-amt${row.kind === 'income' ? ' in' : ''}` }, amountText(row))),
    h('div', { class: 'tx-controls' }, controls,
      !isComplete(row) && h('span', { class: 'chip' }, `⚑ Choose ${row.cat ? 'a subcategory' : 'a category and subcategory'} to save`),
      isComplete(row) && row.needsReview && h('span', { class: 'chip' }, '⚑ Check'),
      canConfirm && h('button', { class: 'ghost small', onclick: () => commit({}) }, 'Looks right'),
      h('button', { class: 'ghost small del', 'aria-label': `Delete ${row.desc}`, onclick: () => ctx.remove(row) }, 'Delete')));
  ctx.els.set(row.id, el);
  return el;
}

function offerApplyToOthers(row, list, apply) {
  const key = merchantKey(row.desc);
  const sameMerchant = other => other === key || other.startsWith(`${key} `) || key.startsWith(`${other} `);
  const others = list.filter(r => r !== row && !r.edited && sameMerchant(merchantKey(r.desc)) && (r.kind !== row.kind || r.cat !== row.cat || r.sub !== row.sub));
  if (!isComplete(row) || !others.length) return;
  toast(`Remembered for ${key}.`, { label: `Apply to ${others.length} other${others.length > 1 ? 's' : ''}`, run: () => apply(others) });
}

/* ---------- Import ---------- */

function newPending() {
  return { files: [], edits: new Map(), removed: new Set(), rules: structuredClone(S.rules), rows: [], tab: 'review', els: new Map() };
}

function pendingCategories() {
  return S.pending?.files.find(f => f.workbook)?.categories || S.categories;
}

function rebuildPending() {
  const P = S.pending;
  const existing = new Set(S.tx.map(r => r.id));
  const rules = structuredClone(S.rules);
  for (const f of P.files) {
    if (f.workbook) f.rows.forEach(r => learn(rules, r));
  }
  for (const [id, e] of P.edits) learn(rules, { id, desc: e.desc, kind: e.kind, cat: e.cat, sub: e.sub }, { manual: true });
  P.rules = rules;

  const bankRows = [];
  for (const f of P.files) {
    if (f.workbook) continue;
    f.fresh = f.rows.filter(r => !existing.has(r.id) && !S.deleted.has(r.id) && !P.removed.has(r.id));
    f.duplicates = f.rows.filter(r => existing.has(r.id)).length;
    f.deletedBefore = f.rows.filter(r => S.deleted.has(r.id) && !existing.has(r.id)).map(r => r.id);
    bankRows.push(...f.fresh);
  }
  const classified = classifyAll(bankRows, rules, pendingCategories());
  for (const r of classified) {
    const e = P.edits.get(r.id);
    if (e) Object.assign(r, { kind: e.kind, cat: e.cat, sub: e.sub, edited: true, needsReview: !isComplete(e) });
  }
  P.rows = classified.sort((a, b) => a.date.localeCompare(b.date));
  P.history = P.files.filter(f => f.workbook).flatMap(f => f.rows.filter(r => !existing.has(r.id) && !S.deleted.has(r.id)));
}

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  S.pending ||= newPending();
  S.view = 'import';
  for (const file of files) {
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const { categories, rows } = await readWorkbook(await file.arrayBuffer());
        S.pending.files.push({ workbook: true, fileName: file.name, categories, rows });
      } else if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        const parsed = readExport(await file.text(), file.name, S.profiles);
        if (!parsed.dataRows.length) throw new Error('No transactions found in this file.');
        S.pending.files.push(parsed);
      } else {
        toast(`${file.name}: only .csv and .xlsx files can be imported.`);
      }
    } catch (err) {
      toast(`${file.name}: ${err.message}`);
    }
  }
  if (!S.pending.files.length) S.pending = null;
  else rebuildPending();
  render();
  for (const f of S.pending?.files.filter(f => !f.workbook && !f.recognized) || []) await openMapper(f);
}

function reapplyMap(file) {
  Object.assign(file, normalizeRows(file.dataRows, file.headers, file.map), { recognized: true });
  rebuildPending();
}

async function rememberFormat(file) {
  const profile = { ...file.map, id: file.signature, custom: true, headers: file.signature.split('|') };
  S.profiles = [...S.profiles.filter(p => p.id !== profile.id), profile];
  await store.setKv('profiles', S.profiles);
}

function openMapper(file) {
  const headers = file.headers;
  const m = { amountMode: 'signed', spendSign: -1, ...file.map };
  m.account ||= file.fileName.replace(/\.[^.]+$/, '');
  return dialog(close => {
    const preview = h('div', { class: 'map-preview' });
    const columns = ['', ...headers];
    const pick = (label, key) => h('label', { class: 'field' }, label,
      select(label, m[key] || '', columns.map(c => [c, c || '—']), v => { m[key] = v; update(); }));

    const amountFields = h('div', { class: 'stack' });
    const drawAmount = () => {
      const parts = [];
      if (m.amountMode === 'debitCredit') parts.push(pick('Money out column', 'debit'), pick('Money in column', 'credit'));
      else parts.push(pick('Amount column', 'amount'));
      if (m.amountMode === 'amountType') parts.push(pick('Debit/credit column', 'type'));
      if (m.amountMode === 'signed') {
        parts.push(h('label', { class: 'field' }, 'In this file, spending appears as',
          select('Spending sign', String(m.spendSign), [['-1', 'Negative, like -45.00'], ['1', 'Positive, like 45.00']], v => { m.spendSign = +v; update(); })));
      }
      amountFields.replaceChildren(...parts);
    };
    const update = () => {
      preview.replaceChildren();
      if (!m.date || !m.desc) { preview.append(h('p', { class: 'muted' }, 'Choose the date and description columns.')); return; }
      const { rows, problems } = normalizeRows(file.dataRows, headers, m);
      preview.append(
        h('h3', {}, `Result: ${rows.length} rows${problems.length ? `, ${problems.length} unreadable` : ''}`),
        ...rows.slice(0, 4).map(r => h('div', { class: 'row between' }, h('span', {}, `${r.date}  ${r.desc}`), h('b', {}, r.cents >= 0 ? `spent ${fmt(r.cents)}` : `received ${fmt(-r.cents)}`))));
    };
    drawAmount(); update();
    return h('div', { class: 'stack mapper' },
      h('h2', {}, 'Tell me about this file'),
      h('p', { class: 'muted' }, `${file.fileName}. You only do this once per format.`),
      h('div', { class: 'scroll' }, h('table', { class: 'sample' },
        h('thead', {}, h('tr', {}, headers.map(c => h('th', {}, c)))),
        h('tbody', {}, file.dataRows.slice(0, 3).map(r => h('tr', {}, headers.map((_, i) => h('td', {}, r[i] ?? ''))))))),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Account name', h('input', { value: m.account, 'aria-label': 'Account name', oninput: e => { m.account = e.target.value; } })),
        h('label', { class: 'field' }, 'Account type', select('Account type', m.accountType, [['card', 'Credit card'], ['checking', 'Checking or savings']], v => { m.accountType = v; })),
        pick('Date column', 'date'), pick('Description column', 'desc'),
        h('label', { class: 'field' }, 'How amounts are shown', select('Amount style', m.amountMode, [['signed', 'One amount column'], ['debitCredit', 'Separate money out and money in columns'], ['amountType', 'Amount plus a debit/credit column']], v => { m.amountMode = v; drawAmount(); update(); })),
        pick('Bank category column (optional)', 'category')),
      amountFields, preview,
      h('div', { class: 'row end' },
        h('button', { class: 'ghost', onclick: () => { if (!file.recognized) removeFile(file); close(null); render(); } }, 'Cancel'),
        h('button', { class: 'primary', onclick: async () => {
          if (!m.date || !m.desc || !m.account.trim()) return toast('Choose a date column, a description column and an account name.');
          file.map = m;
          reapplyMap(file);
          await rememberFormat(file);
          close(true); render();
        } }, 'Use this format')));
  });
}

function removeFile(file) {
  S.pending.files = S.pending.files.filter(f => f !== file);
  if (S.pending.files.length) rebuildPending(); else S.pending = null;
}

function fileCard(file) {
  const remove = h('button', { class: 'ghost small', 'aria-label': `Remove ${file.fileName}`, onclick: () => { removeFile(file); render(); } }, 'Remove');
  if (file.workbook) {
    const spend = file.rows.filter(r => r.kind === 'expense').length;
    return h('section', { class: 'card file' }, h('div', { class: 'row between' }, h('div', {}, h('h3', {}, 'Your spreadsheet'), h('p', { class: 'muted' }, file.fileName)), remove),
      h('p', {}, `${spend} expenses, ${file.rows.length - spend} income entries and ${Object.keys(file.categories).length} categories. Your merchants will teach the auto-categorizer.`));
  }
  if (!file.recognized) {
    return h('section', { class: 'card file warn' }, h('div', { class: 'row between' }, h('div', {}, h('h3', {}, 'Format not recognized'), h('p', { class: 'muted' }, file.fileName)), remove),
      h('button', { class: 'primary', onclick: () => openMapper(file) }, 'Set up this format'));
  }
  const fresh = file.fresh || [];
  const dates = fresh.map(r => r.date).sort();
  const out = fresh.filter(r => r.cents > 0).reduce((s, r) => s + r.cents, 0);
  const inn = fresh.filter(r => r.cents < 0).reduce((s, r) => s - r.cents, 0);
  const flipped = looksFlipped(fresh, file.map.accountType);
  return h('section', { class: `card file${flipped ? ' warn' : ''}` },
    h('div', { class: 'row between' }, h('div', {}, h('h3', {}, file.map.account), h('p', { class: 'muted' }, file.fileName)), remove),
    h('p', {}, dates.length ? `${fresh.length} new rows, ${prettyDate(dates[0])} to ${prettyDate(dates[dates.length - 1])}` : 'No new rows'),
    h('p', { class: 'muted' }, `${fmt(out)} out · ${fmt(inn)} in`),
    file.duplicates > 0 && h('p', { class: 'muted' }, `${file.duplicates} already imported, skipped.`),
    file.deletedBefore?.length > 0 && h('p', { class: 'muted' }, `${file.deletedBefore.length} you deleted earlier, skipped. `,
      h('button', { class: 'link', onclick: async () => { file.deletedBefore.forEach(id => S.deleted.delete(id)); await saveDeleted(); rebuildPending(); render(); } }, 'Bring back')),
    file.problems.length > 0 && h('details', {}, h('summary', {}, `${file.problems.length} rows could not be read and were left out`), file.problems.slice(0, 20).map(p => h('p', { class: 'muted' }, p.text))),
    flipped && h('p', { class: 'notice' }, 'Most rows on this card look like money coming in, so spending may be backwards.'),
    h('div', { class: 'row' },
      flipped && file.map.amountMode === 'signed' && h('button', { class: 'primary small', onclick: async () => { file.map = { ...file.map, spendSign: -file.map.spendSign }; reapplyMap(file); await rememberFormat(file); render(); } }, 'Flip the sign'),
      h('button', { class: 'ghost small', onclick: () => openMapper(file) }, 'Fix columns')));
}

const pendingCtx = {
  els: new Map(),
  categories: pendingCategories,
  addCategory: async name => { const c = pendingCategories(); c[name] = []; if (c === S.categories) await saveCategories(c); },
  addSub: async (cat, sub) => { const c = pendingCategories(); c[cat] = [...(c[cat] || []), sub]; if (c === S.categories) await saveCategories(c); },
  remove(row) {
    const P = S.pending;
    P.removed.add(row.id);
    P.rows = P.rows.filter(r => r !== row);
    for (const f of P.files) if (f.fresh) f.fresh = f.fresh.filter(r => r.id !== row.id);
    pendingCtx.els.get(row.id)?.remove();
    if (!document.querySelector('#review-list')?.children.length) renderReviewList();
    document.querySelector('.files')?.replaceChildren(...P.files.map(fileCard));
    updateImportCounts();
    toast(`Deleted ${row.desc}.`, { label: 'Undo', run: () => {
      if (S.pending !== P) return;
      P.removed.delete(row.id);
      rebuildPending();
      render();
    } });
  },
  changed(row) {
    const P = S.pending;
    P.edits.set(row.id, { desc: row.desc, kind: row.kind, cat: row.cat, sub: row.sub });
    updateImportCounts();
    offerApplyToOthers(row, P.rows, others => {
      for (const r of others) {
        Object.assign(r, { kind: row.kind, cat: row.cat, sub: row.sub, needsReview: false, edited: true });
        P.edits.set(r.id, { desc: r.desc, kind: r.kind, cat: r.cat, sub: r.sub });
      }
      renderReviewList();
      updateImportCounts();
    });
  },
};

const reviewTabs = () => {
  const rows = S.pending.rows;
  return [
    ['review', 'Needs a look', rows.filter(r => r.needsReview).sort((a, b) => isComplete(a) - isComplete(b))],
    ['all', 'All', rows],
    ['off', 'Not counted', rows.filter(r => r.kind === 'transfer')],
  ];
};

function updateImportCounts() {
  const P = S.pending;
  if (!P) return;
  for (const [id, label, rows] of reviewTabs()) {
    const b = document.querySelector(`[data-tab="${id}"]`);
    if (b) b.textContent = `${label} (${rows.length})`;
  }
  const sum = document.querySelector('#save-summary');
  if (sum) sum.textContent = saveSummary();
  const total = document.querySelector('#save-total');
  if (total) total.textContent = `${pendingTotal()} new transactions`;
  const button = document.querySelector('#save-import');
  if (button) button.disabled = !canSave();
}

const pendingTotal = () => S.pending.rows.length + (S.pending.history?.length || 0);

function canSave() {
  const P = S.pending;
  return pendingTotal() > 0 && P.files.every(f => f.workbook || f.recognized) && P.rows.every(isComplete);
}

function saveSummary() {
  const P = S.pending;
  const spend = P.rows.filter(r => r.kind === 'expense').reduce((s, r) => s + r.cents, 0);
  const missing = P.rows.filter(r => !isComplete(r)).length;
  if (missing) return `${fmt(spend)} spending · choose a category and subcategory on ${missing} more to save`;
  const review = P.rows.filter(r => r.needsReview).length;
  return `${fmt(spend)} spending${review ? ` · ${review} marked Check` : ''}`;
}

function renderReviewList() {
  const list = document.querySelector('#review-list');
  if (!list) return;
  const P = S.pending;
  const [, , rows] = reviewTabs().find(t => t[0] === P.tab);
  pendingCtx.els = new Map();
  list.replaceChildren(...(rows.length ? rows.map(r => txRow(r, pendingCtx)) : [h('p', { class: 'muted empty' }, P.tab === 'review' ? 'Nothing needs a look.' : 'Nothing here.')]));
}

async function savePending() {
  if (!canSave()) return;
  const P = S.pending;
  if (P.removed.size) {
    P.removed.forEach(id => S.deleted.add(id));
    await saveDeleted();
  }
  const batchId = `b${Date.now()}`;
  const fileNames = P.files.map(f => f.fileName);
  const history = P.history || [];
  const rows = [...P.rows, ...history].map(r => ({ ...r, batch: batchId }));
  const workbook = P.files.find(f => f.workbook);
  if (workbook) await saveCategories(workbook.categories);

  for (const [id, e] of P.edits) learn(P.rules, { id, desc: e.desc, kind: e.kind, cat: e.cat, sub: e.sub }, { manual: true });
  for (const r of P.rows) {
    if (r.edited) continue;
    if (r.kind === 'expense' && r.cat && !r.needsReview) learn(P.rules, r);
  }
  await store.putTx(rows);
  S.rules = P.rules;
  await store.setKv('rules', S.rules);
  S.batches = [{ id: batchId, at: new Date().toISOString(), files: fileNames, count: rows.length }, ...S.batches];
  await store.setKv('batches', S.batches);
  S.tx.push(...rows);
  navigator.storage?.persist?.();

  const latest = P.rows.length ? P.rows.map(monthOf).sort().pop() : monthsPresent(S.tx).pop();
  S.pending = null;
  S.month = latest; S.year = latest?.slice(0, 4);
  S.view = 'report';
  render();
  toast(`Saved ${rows.length} transactions.`);
}

function viewImport() {
  const P = S.pending;
  const input = h('input', { type: 'file', multiple: true, accept: '.csv,.tsv,.txt,.xlsx', hidden: true, id: 'file-input', onchange: e => { addFiles(e.target.files); e.target.value = ''; } });
  const zone = h('section', { class: 'drop', id: 'drop', tabindex: 0, role: 'button', onclick: () => input.click(), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } },
    h('strong', {}, 'Drop your bank exports here'),
    h('span', { class: 'muted' }, 'or click to choose files. Drop them all at once so card payments can be matched.'),
    input);
  const out = [h('h1', {}, 'Import'), zone];
  if (!P) {
    if (!S.tx.length) out.push(h('section', { class: 'card' }, h('h3', {}, 'First time here?'), h('p', {}, 'Start by dropping your MonthlyExpense.xlsx. It loads your history and categories, and teaches the app your merchants.')));
    out.push(h('p', { class: 'muted privacy' }, 'Files are read on this device and are never uploaded.'));
    return out;
  }
  out.push(h('div', { class: 'files' }, P.files.map(fileCard)));

  const historyMonths = new Set(S.tx.concat(P.history || []).filter(r => r.account === 'Spreadsheet').map(monthOf));
  const overlap = [...new Set(P.rows.map(monthOf).filter(m => historyMonths.has(m)))];
  if (overlap.length) out.push(h('p', { class: 'notice' }, `Your spreadsheet already has ${overlap.map(monthLabel).join(', ')}. Saving these would count that spending twice.`));

  if (P.rows.length) {
    if (!reviewTabs()[0][2].length && P.tab === 'review') P.tab = 'all';
    out.push(h('h2', {}, 'Review before saving'),
      h('div', { class: 'tabs', role: 'tablist' }, reviewTabs().map(([id, label, rows]) =>
        h('button', { 'data-tab': id, role: 'tab', 'aria-selected': String(P.tab === id), class: P.tab === id ? 'on' : '', onclick: () => { P.tab = id; render(); } }, `${label} (${rows.length})`))),
      h('div', { id: 'review-list', class: 'list' }));
  }
  out.push(h('div', { class: 'savebar' },
    h('div', {}, h('strong', { id: 'save-total' }, `${pendingTotal()} new transactions`), h('div', { class: 'muted', id: 'save-summary' }, P.rows.length ? saveSummary() : '')),
    h('div', { class: 'row' },
      h('button', { class: 'ghost', onclick: () => { S.pending = null; render(); } }, 'Discard'),
      h('button', { class: 'primary', id: 'save-import', disabled: !canSave(), onclick: savePending }, 'Save'))));
  return out;
}

/* ---------- Reports ---------- */

function monthPicker() {
  const months = monthsPresent(S.tx);
  const i = months.indexOf(S.month);
  const go = m => { S.month = m; S.openCat = null; render(); };
  return h('div', { class: 'picker' },
    h('button', { class: 'ghost icon', 'aria-label': 'Earlier month', disabled: i <= 0, onclick: () => go(months[i - 1]) }, '‹'),
    select('Month', S.month, [...months].reverse().map(m => [m, monthLabel(m)]), go, { id: 'month' }),
    h('button', { class: 'ghost icon', 'aria-label': 'Later month', disabled: i >= months.length - 1, onclick: () => go(months[i + 1]) }, '›'));
}

function tile(label, value, note, id) {
  const isWord = !/\d/.test(value);
  return h('div', { class: 'tile', id }, h('span', { class: 'muted' }, label), h('b', { class: isWord ? 'word' : '' }, value), note ? h('span', { class: 'muted small-text' }, note) : false);
}

const noData = () => [h('h1', {}, 'Money Manager'), h('section', { class: 'card stack' }, h('p', {}, 'No transactions yet.'), h('button', { class: 'primary', onclick: () => { S.view = 'import'; render(); } }, 'Import your first files'))];

function viewReport() {
  if (!monthsPresent(S.tx).length) return noData();
  const s = monthSummary(S.tx, S.month);
  const prev = monthSummary(S.tx, previousMonth(S.month));
  const delta = prev.count ? s.spent - prev.spent : null;
  const deltaNote = delta === null ? null : `${delta > 0 ? 'up' : 'down'} ${fmt(Math.abs(delta))} from ${MONTH_NAMES[+previousMonth(S.month).slice(5) - 1]}`;
  const out = [h('div', { class: 'row between title' }, h('h1', {}, 'Monthly report'), monthPicker()),
    h('div', { class: 'tiles' },
      tile('Spent', fmt(s.spent), deltaNote, 'kpi-spent'),
      tile('Income', fmt(s.earned), null, 'kpi-income'),
      tile('Saved', fmt(s.saved), null, 'kpi-saved'),
      tile('Transactions', String(s.count), s.transfers ? `${s.transfers} transfers left out` : null, 'kpi-count'))];

  const missing = missingCards(S.tx, S.month);
  const notes = [];
  if (missing.length) notes.push(`You paid ${missing.join(' and ')} this month, but no export from ${missing.length > 1 ? 'those cards' : 'that card'} is imported, so ${missing.length > 1 ? 'their' : 'its'} spending is missing.`);
  if (!s.earned && s.spent) notes.push('No income is recorded for this month.');
  out.push(...notes.map(n => h('p', { class: 'notice' }, n)));
  if (s.review) out.push(h('button', { class: 'review-link', onclick: () => { S.filter = { month: S.month, show: 'review' }; S.view = 'tx'; render(); } }, `⚑ ${s.review} transaction${s.review > 1 ? 's' : ''} need a look`));

  const max = Math.max(1, ...s.categories.map(c => c.cents));
  const rows = s.categories.map(c => {
    const open = S.openCat === c.name;
    return h('div', { class: 'cat' },
      h('button', { class: 'bar-row', 'aria-expanded': String(open), onclick: () => { S.openCat = open ? null : c.name; render(); } },
        h('span', { class: 'bar-label' }, c.name),
        h('span', { class: 'bar-track' }, barFill(c.cents / max)),
        h('span', { class: 'bar-value' }, fmt(c.cents)),
        h('span', { class: 'bar-pct muted' }, s.spent ? `${Math.round(c.cents / s.spent * 100)}%` : '')),
      open && categoryDetail(c));
  });
  out.push(h('section', { class: 'card' }, h('h2', {}, 'By category'), rows.length ? h('div', {}, rows) : h('p', { class: 'muted' }, 'No expenses this month.')));
  if (s.accounts.length) {
    out.push(h('section', { class: 'card' }, h('h2', {}, 'By account'), s.accounts.map(a => h('div', { class: 'row between line' }, h('span', {}, a.name), h('b', { class: 'num' }, fmt(a.cents))))));
  }
  return out;
}

function barFill(share) {
  const el = h('span', { class: 'bar-fill' });
  el.style.width = `${Math.max(0, share * 100)}%`;
  return el;
}

function categoryDetail(c) {
  const rows = S.tx.filter(r => monthOf(r) === S.month && r.kind === 'expense' && (r.cat || UNCATEGORIZED) === c.name).sort((a, b) => b.cents - a.cents);
  return h('div', { class: 'detail' },
    c.subs.map(sub => h('div', { class: 'row between line' }, h('span', {}, sub.name), h('b', { class: 'num' }, fmt(sub.cents)))),
    h('button', { class: 'link', onclick: () => { S.filter = { month: S.month, cat: c.name }; S.view = 'tx'; render(); } }, `See or change these ${rows.length} transactions`));
}

function yearsPresent() {
  return [...new Set(monthsPresent(S.tx).map(m => m.slice(0, 4)))];
}

function barPath(x, y, w, baseline, r = 4) {
  const radius = Math.min(r, w / 2, baseline - y);
  return `M${x},${baseline}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${baseline}Z`;
}

function incomeExpenseChart(m) {
  const W = Math.max(300, Math.min(main.clientWidth, 1000) - 64);
  const H = 240, left = 44, top = 12, bottom = 26, baseline = H - bottom;
  const peak = Math.max(1, ...m.expense, ...m.income);
  const step = [50000, 100000, 200000, 250000, 500000, 1000000, 2500000].find(s => peak / s <= 4) || 5000000;
  const ceil = Math.ceil(peak / step) * step;
  const y = v => baseline - (Math.max(0, v) / ceil) * (baseline - top);
  const band = (W - left) / 12;
  const barW = Math.min(14, (band - 8) / 2);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Income and expense for each month. The table below has the same numbers.' });
  for (let v = 0; v <= ceil; v += step) {
    svg.append(svgEl('line', { x1: left, x2: W, y1: y(v), y2: y(v), class: 'grid' }));
    const t = svgEl('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }); t.textContent = fmtShort(v); svg.append(t);
  }
  const tip = h('div', { class: 'chart-tip', hidden: true });
  MONTH_NAMES.forEach((name, i) => {
    const cx = left + band * i + band / 2;
    const inc = m.income[i], exp = m.expense[i];
    if (inc > 0) svg.append(svgEl('path', { d: barPath(cx - barW - 1, y(inc), barW, baseline), class: 'series-income' }));
    if (exp > 0) svg.append(svgEl('path', { d: barPath(cx + 1, y(exp), barW, baseline), class: 'series-expense' }));
    const t = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'tick' }); t.textContent = W < 520 ? name[0] : name.slice(0, 3); svg.append(t);
    const hit = svgEl('rect', { x: left + band * i, y: 0, width: band, height: H, fill: 'transparent' });
    const show = e => {
      tip.hidden = false;
      tip.replaceChildren(h('strong', {}, name), h('div', {}, `Income ${fmt(inc)}`), h('div', {}, `Expense ${fmt(exp)}`), h('div', {}, `Saved ${fmt(inc - exp)}`));
      const box = svg.getBoundingClientRect();
      tip.style.left = `${Math.min(cx, W - 150)}px`;
      tip.style.top = `${Math.max(0, (e.clientY || box.top) - box.top - 40)}px`;
    };
    hit.addEventListener('mousemove', show);
    hit.addEventListener('click', show);
    hit.addEventListener('mouseleave', () => { tip.hidden = true; });
    svg.append(hit);
  });
  const legend = h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'swatch income' }), 'Income'), h('span', {}, h('i', { class: 'swatch expense' }), 'Expense'));
  return h('div', { class: 'chart' }, legend, h('div', { class: 'chart-plot' }, svg, tip));
}

function viewYear() {
  const years = yearsPresent();
  if (!years.length) return noData();
  if (!years.includes(S.year)) S.year = years[years.length - 1];
  const m = yearMatrix(S.tx, S.year, S.categories);
  const top = [...m.table].sort((a, b) => b.total - a.total)[0];
  const openMonth = i => { S.month = `${S.year}-${String(i + 1).padStart(2, '0')}`; S.view = 'report'; render(); };
  const cell = c => h('td', { class: c ? 'num' : 'num zero' }, c ? fmt(c) : '–');
  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const savings = m.income.map((v, i) => v - m.expense[i]);
  return [
    h('div', { class: 'row between title' }, h('h1', {}, 'Year view'), select('Year', S.year, [...years].reverse(), v => { S.year = v; render(); }, { id: 'year' })),
    h('div', { class: 'tiles' },
      tile('Total spend', fmt(m.spent)), tile('Average per month', fmt(m.active ? Math.round(m.spent / m.active) : 0), `across ${m.active} months`),
      tile('Top category', top?.total ? top.name : '–', top?.total ? fmt(top.total) : null), tile('Income', fmt(m.earned)), tile('Saved', fmt(m.earned - m.spent))),
    h('section', { class: 'card' }, h('h2', {}, 'Income and expense'), incomeExpenseChart(m)),
    h('section', { class: 'card' }, h('h2', {}, 'Category by month'),
      h('div', { class: 'scroll' }, h('table', { class: 'matrix' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Category'), MONTH_NAMES.map((n, i) => h('th', { class: 'num' }, h('button', { class: 'link', onclick: () => openMonth(i) }, n.slice(0, 3)))), h('th', { class: 'num' }, 'Total'))),
        h('tbody', {}, m.table.filter(t => t.total !== 0).map(t => h('tr', {}, h('th', {}, t.name), t.months.map(cell), h('td', { class: 'num strong' }, fmt(t.total))))),
        h('tfoot', {},
          h('tr', {}, h('th', {}, 'Total expense'), m.expense.map(cell), h('td', { class: 'num strong' }, fmt(m.spent))),
          h('tr', {}, h('th', {}, 'Income'), m.income.map(cell), h('td', { class: 'num strong' }, fmt(m.earned))),
          h('tr', {}, h('th', {}, 'Saved'), savings.map(cell), h('td', { class: 'num strong' }, fmt(sum(savings)))))))),
  ];
}

/* ---------- Transactions ---------- */

const txCtx = {
  els: new Map(),
  categories: () => S.categories,
  addCategory: async name => { await saveCategories({ ...S.categories, [name]: [] }); },
  addSub: async (cat, sub) => { await saveCategories({ ...S.categories, [cat]: [...(S.categories[cat] || []), sub] }); },
  beforeChange(row) {
    if (!S.drafts.has(row.id)) S.drafts.set(row.id, { kind: row.kind, cat: row.cat, sub: row.sub, needsReview: row.needsReview, edited: row.edited });
  },
  async remove(row) {
    if (S.drafts.has(row.id)) { Object.assign(row, S.drafts.get(row.id)); S.drafts.delete(row.id); }
    S.tx = S.tx.filter(r => r !== row);
    S.deleted.add(row.id);
    await store.deleteTx([row.id]);
    await saveDeleted();
    txCtx.els.get(row.id)?.remove();
    updateTxCount();
    pickDefaults();
    toast(`Deleted ${row.desc}.`, { label: 'Undo', run: async () => {
      S.tx.push(row);
      S.deleted.delete(row.id);
      await store.putTx([row]);
      await saveDeleted();
      pickDefaults();
      drawTxList();
    } });
  },
  async changed(row) {
    if (!isComplete(row)) return; // Held on screen only until the subcategory is chosen.
    S.drafts.delete(row.id);
    await store.putTx([row]);
    learn(S.rules, row, { manual: true });
    await store.setKv('rules', S.rules);
    offerApplyToOthers(row, S.tx, async others => {
      for (const r of others) Object.assign(r, { kind: row.kind, cat: row.cat, sub: row.sub, needsReview: false, edited: true });
      await store.putTx(others);
      render();
    });
  },
};

function filteredTx() {
  const f = S.filter;
  const q = (f.q || '').toLowerCase();
  return S.tx.filter(r =>
    (!f.month || monthOf(r) === f.month)
    && (!f.account || r.account === f.account)
    && (!f.cat || (r.cat || UNCATEGORIZED) === f.cat)
    && (!q || r.desc.toLowerCase().includes(q) || (r.sub || '').toLowerCase().includes(q))
    && (!f.show || (f.show === 'review' ? r.needsReview : r.kind === f.show)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.desc.localeCompare(b.desc));
}

/** Puts back any row left with a category but no subcategory, so half-finished edits never count. */
function revertDrafts() {
  if (!S.drafts.size) return;
  for (const [id, original] of S.drafts) {
    const row = S.tx.find(r => r.id === id);
    if (row) Object.assign(row, original);
  }
  S.drafts.clear();
  toast('An unfinished category change was not saved.');
}

function updateTxCount() {
  const rows = filteredTx();
  const total = rows.filter(r => r.kind === 'expense').reduce((s, r) => s + r.cents, 0);
  const label = document.querySelector('#tx-count');
  if (label) label.textContent = `${rows.length} shown · ${fmt(total)} spending`;
}

function drawTxList() {
  const box = document.querySelector('#tx-list');
  if (!box) return;
  revertDrafts();
  const rows = filteredTx();
  const limit = S.filter.limit || 100;
  txCtx.els = new Map();
  updateTxCount();
  box.replaceChildren(...rows.slice(0, limit).map(r => txRow(r, txCtx)),
    ...(rows.length > limit ? [h('button', { class: 'ghost wide', onclick: () => { S.filter.limit = limit + 200; drawTxList(); } }, `Show more (${rows.length - limit} left)`)] : []),
    ...(rows.length ? [] : [h('p', { class: 'muted empty' }, 'Nothing matches.')]));
}

function viewTx() {
  const f = S.filter;
  const months = [...new Set(S.tx.map(monthOf))].sort().reverse();
  const accounts = [...new Set(S.tx.map(r => r.account))].sort();
  const set = key => v => { f[key] = v; f.limit = 100; drawTxList(); };
  setTimeout(drawTxList);
  return [
    h('h1', {}, 'Transactions'),
    h('div', { class: 'filters' },
      h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search transactions', value: f.q || '', oninput: e => set('q')(e.target.value) }),
      select('Month', f.month || '', [['', 'All months'], ...months.map(m => [m, monthLabel(m)])], set('month')),
      select('Account', f.account || '', [['', 'All accounts'], ...accounts], set('account')),
      select('Category', f.cat || '', [['', 'All categories'], ...Object.keys(S.categories), UNCATEGORIZED], set('cat')),
      select('Show', f.show || '', [['', 'Everything'], ['review', 'Needs a look'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Not counted']], set('show'))),
    h('p', { class: 'muted', id: 'tx-count' }),
    h('div', { class: 'list', id: 'tx-list' }),
  ];
}

/* ---------- Data and backup ---------- */

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function makeBackup() {
  const pass = await askText('Create a backup', { label: 'Passphrase', type: 'password', action: 'Continue', note: 'The file is unreadable without this. If you forget it, the backup cannot be recovered.' });
  if (!pass) return;
  const again = await askText('Type the passphrase again', { type: 'password', action: 'Save backup' });
  if (again !== pass) return toast('Those passphrases did not match, so no backup was made.');
  toast('Encrypting…');
  const text = await store.encryptBackup(await store.exportAll(), pass);
  download(`money-manager-${new Date().toISOString().slice(0, 10)}.backup`, text, 'application/octet-stream');
  await store.setKv('lastBackup', new Date().toISOString());
  toast('Backup saved. Keep it in OneDrive to open it on another device.');
}

async function restoreBackup(file) {
  const pass = await askText('Restore a backup', { label: 'Passphrase', type: 'password', action: 'Continue' });
  if (!pass) return;
  try {
    const data = await store.decryptBackup(await file.text(), pass);
    if (!await confirmIt('Replace everything on this device?', `The backup has ${data.tx.length} transactions. What is on this device now (${S.tx.length} transactions) will be replaced.`, 'Replace')) return;
    await store.replaceAll(data);
    await loadAll();
    S.view = 'report';
    render();
    toast('Backup restored.');
  } catch (err) {
    toast(err.message);
  }
}

async function undoBatch(b) {
  const rows = S.tx.filter(r => r.batch === b.id);
  if (!await confirmIt('Undo this import?', `This removes the ${rows.length} transactions it added, including any category changes on them.`, 'Undo import')) return;
  await store.deleteTx(rows.map(r => r.id));
  S.tx = S.tx.filter(r => r.batch !== b.id);
  S.batches = S.batches.filter(x => x.id !== b.id);
  await store.setKv('batches', S.batches);
  pickDefaults();
  render();
  toast('Import removed.');
}

function viewData() {
  const restore = h('input', { type: 'file', hidden: true, accept: '.backup,application/octet-stream,*/*', onchange: e => { if (e.target.files[0]) restoreBackup(e.target.files[0]); e.target.value = ''; } });
  const install = window.__installPrompt && h('button', { class: 'primary', onclick: async () => { window.__installPrompt.prompt(); window.__installPrompt = null; render(); } }, 'Install this app');
  return [
    h('h1', {}, 'Data'),
    h('section', { class: 'card stack' }, h('h2', {}, 'Backup and other devices'),
      h('p', {}, 'Your data lives only in this browser. A backup is an encrypted file you can keep in OneDrive and open on your phone.'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: makeBackup }, 'Save backup'), h('button', { class: 'ghost', onclick: () => restore.click() }, 'Restore backup'), restore),
      install),
    h('section', { class: 'card stack' }, h('h2', {}, 'Import history'),
      S.batches.length ? S.batches.map(b => h('div', { class: 'row between line' },
        h('div', {}, h('div', {}, b.files.join(', ')), h('span', { class: 'muted' }, `${prettyDate(b.at.slice(0, 10))} · ${S.tx.filter(r => r.batch === b.id).length} transactions`)),
        h('button', { class: 'ghost small', onclick: () => undoBatch(b) }, 'Undo'))) : h('p', { class: 'muted' }, 'Nothing imported yet.')),
    h('section', { class: 'card stack' }, h('h2', {}, 'Export'),
      h('button', { class: 'ghost', onclick: () => {
        const lines = [['Date', 'Description', 'Amount', 'Type', 'Category', 'Subcategory', 'Account'].join(',')];
        for (const r of [...S.tx].sort((a, b) => a.date.localeCompare(b.date))) lines.push([r.date, r.desc, (r.cents / 100).toFixed(2), r.kind, r.cat, r.sub, r.account].map(csvCell).join(','));
        download('money-manager-transactions.csv', lines.join('\r\n'), 'text/csv');
      } }, 'Download all transactions as CSV')),
    h('section', { class: 'card stack' }, h('h2', {}, 'Erase'),
      h('button', { class: 'danger', onclick: async () => {
        if (!await confirmIt('Erase everything on this device?', 'All transactions, categories and learned merchants on this device will be deleted. Backups are not affected.', 'Erase')) return;
        await store.eraseAll();
        await loadAll();
        S.view = 'import';
        render();
        toast('Erased.');
      } }, 'Erase all data on this device')),
  ];
}

/* ---------- Shell ---------- */

const VIEWS = { report: viewReport, year: viewYear, tx: viewTx, import: viewImport, data: viewData };

function render() {
  revertDrafts();
  main.replaceChildren(...VIEWS[S.view]().flat().filter(Boolean));
  document.querySelectorAll('nav button').forEach(b => {
    if (b.dataset.view === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (S.view === 'import' && S.pending?.rows.length) renderReviewList();
}

function pickDefaults() {
  const months = monthsPresent(S.tx);
  if (!months.includes(S.month)) S.month = months[months.length - 1] || null;
  S.year = S.month?.slice(0, 4) || null;
}

async function loadAll() {
  S.tx = await store.allTx();
  S.rules = await store.getKv('rules') || {};
  S.categories = await store.getKv('categories') || structuredClone(DEFAULT_CATEGORIES);
  S.profiles = await store.getKv('profiles') || [];
  S.batches = await store.getKv('batches') || [];
  S.deleted = new Set(await store.getKv('deleted') || []);
  S.drafts.clear();
  for (const r of S.tx) if (!isComplete(r)) r.needsReview = true;
  S.filter = {};
  S.pending = null;
  S.month = null;
  pickDefaults();
}

document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  S.view = b.dataset.view;
  if (S.view === 'tx') S.filter = {};
  render();
  window.scrollTo(0, 0);
}));

let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  addFiles(e.dataTransfer.files);
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; if (S.view === 'data') render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

await loadAll();
if (!S.tx.length) S.view = 'import';
render();
