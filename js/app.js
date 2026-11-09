import { readExport, normalizeRows, looksFlipped, parseAmount } from './parse.js';
import { classifyAll, learn, merchantOf, isComplete, applyAmount, buildSplit, DEFAULT_CATEGORIES } from './classify.js';
import { MONTH_NAMES, monthOf, monthsPresent, monthChoices, monthLabel, typicalMonthly, UNCATEGORIZED } from './report.js';
import { readWorkbook } from './workbook.js';
import { viewDashboard } from './dashboard.js';
import { h, select, fmt, localToday } from './ui.js';
import * as store from './store.js';
import { migrateData, pinMixedStores, TAXONOMY } from './migrate.js';
import * as lock from './lock.js';

const prettyDate = iso => `${MONTH_NAMES[+iso.slice(5, 7) - 1].slice(0, 3)} ${+iso.slice(8)}, ${iso.slice(0, 4)}`;

const S = { tx: [], rules: {}, categories: DEFAULT_CATEGORIES, profiles: [], batches: [], budgets: {}, deleted: new Set(), drafts: new Map(), view: 'dashboard', scope: 'month', month: null, year: null, pending: null, filter: {}, openCat: null };
const saveDeleted = () => store.setKv('deleted', [...S.deleted]);
const main = document.querySelector('#main');

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

const withSavings = cats => (cats.Savings ? cats : { ...cats, Savings: DEFAULT_CATEGORIES.Savings });

async function saveCategories(cats) {
  S.categories = cats;
  await store.setKv('categories', cats);
}

/* ---------- One transaction, with its type and category controls ---------- */

const NEW = '__new';
function incomeSources() {
  return [...new Set(['Salary', 'Other', ...S.tx.filter(r => r.kind === 'income' && r.sub).map(r => r.sub)])];
}

function amountText(row) {
  if (row.kind === 'income') return `+${fmt(-row.cents)}`;
  if (row.cents < 0) return `−${fmt(-row.cents)}`;
  return fmt(row.cents);
}

/** Changes what you see. The row's id and the bank's wording stay, so duplicates are still caught. */
function applyRename(row, next) {
  const original = row.origDesc || row.desc;
  if (row.id.startsWith('Manual|') || next === original) delete row.origDesc;
  else row.origDesc = original;
  row.desc = next;
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
    else if (kind === 'savings') {
      const subs = ctx.categories().Savings || [];
      commit({ kind, cat: 'Savings', sub: subs.length === 1 ? subs[0] : '' });
    } else if (kind === 'transfer') commit({ kind, cat: '', sub: '' });
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
      if (row.kind !== 'income') await ctx.addSub(row.cat, sub);
    }
    commit({ sub });
  };

  const cats = ctx.categories();
  const controls = [select('Type', row.kind, [['expense', 'Expense'], ['income', 'Income'], ['savings', 'Savings'], ['transfer', 'Not counted']], changeKind, { class: 'kind' })];
  if (row.kind === 'savings') {
    const subs = cats.Savings || [];
    controls.push(select('Savings subcategory', row.sub, [['', 'Choose subcategory…'], ...subs, ...(row.sub && !subs.includes(row.sub) ? [row.sub] : []), [NEW, '+ New subcategory…']], changeSub, { class: row.sub ? '' : 'missing' }));
  } else if (row.kind === 'expense') {
    controls.push(select('Category', row.cat, [['', 'Choose category…'], ...Object.keys(cats).filter(c => c !== 'Savings'), ...(row.cat && !cats[row.cat] ? [row.cat] : []), [NEW, '+ New category…']], changeCat, { class: row.cat ? '' : 'missing' }));
    const subs = cats[row.cat] || [];
    controls.push(select('Subcategory', row.sub, [['', row.cat ? 'Choose subcategory…' : '—'], ...subs, ...(row.sub && !subs.includes(row.sub) ? [row.sub] : []), ...(row.cat ? [[NEW, '+ New subcategory…']] : [])], changeSub, { disabled: !row.cat, class: row.cat && !row.sub ? 'missing' : '' }));
  } else if (row.kind === 'income') {
    const sources = incomeSources();
    controls.push(select('Income source', row.sub, [...sources, ...(sources.includes(row.sub) ? [] : [row.sub]), [NEW, '+ New source…']], changeSub));
  } else {
    controls.push(h('span', { class: 'muted not-counted' }, 'Left out of all totals'));
  }

  const title = h('div', { class: 'desc-line' }, h('strong', {}, row.desc));
  const startEdit = () => {
    const input = h('input', { value: row.desc, 'aria-label': 'New description', maxlength: 200, autocomplete: 'off', onkeydown: e => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); redraw(); }
    } });
    const save = async () => {
      const next = input.value.replace(/\s+/g, ' ').trim();
      if (!next) { toast('A description can’t be empty.'); input.focus(); return; }
      if (next !== row.desc) await ctx.rename(row, next);
      redraw();
    };
    title.replaceWith(h('div', { class: 'desc-edit' }, input,
      h('button', { class: 'primary small', onclick: save }, 'Save'),
      h('button', { class: 'ghost small', onclick: redraw }, 'Cancel')));
    input.focus();
    input.select();
  };
  title.append(h('button', { class: 'link edit-desc', 'aria-label': 'Edit description', onclick: startEdit }, 'Edit'));

  const amountBox = h('div', { class: `tx-amt${row.kind === 'income' ? ' in' : ''}` }, amountText(row));
  const startAmountEdit = () => {
    const input = h('input', { value: ((row.kind === 'income' ? -row.cents : row.cents) / 100).toFixed(2), inputmode: 'decimal', 'aria-label': 'New amount', autocomplete: 'off', onkeydown: e => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); redraw(); }
    } });
    const save = async () => {
      const cents = parseAmount(input.value);
      if (!cents || (row.kind === 'income' && cents < 0)) { toast('Enter an amount other than zero.'); input.focus(); return; }
      const next = row.kind === 'income' ? -cents : cents;
      if (next !== row.cents) await ctx.setAmount(row, next);
      redraw();
    };
    amountBox.replaceWith(h('div', { class: 'amt-edit' }, input,
      h('button', { class: 'primary small', onclick: save }, 'Save'),
      h('button', { class: 'ghost small', onclick: redraw }, 'Cancel')));
    input.focus();
    input.select();
  };
  if (!row.splitOf) amountBox.append(h('button', { class: 'link edit-desc', 'aria-label': 'Edit amount', onclick: startAmountEdit }, 'Edit'));

  const canConfirm = row.needsReview && isComplete(row);
  const el = h('article', { class: `tx${row.needsReview ? ' review' : ''}${row.kind === 'transfer' ? ' off' : ''}` },
    h('div', { class: 'tx-head' },
      h('div', { class: 'tx-desc' },
        title,
        h('span', { class: 'muted' }, [prettyDate(row.date), row.account, row.bankCategory && `bank says: ${row.bankCategory}`].filter(Boolean).join(' · ')),
        row.origDesc && h('span', { class: 'muted small-text' }, `originally: ${row.origDesc}`),
        row.origCents !== undefined && h('span', { class: 'muted small-text' }, `original amount: ${fmt(Math.abs(row.origCents))}`),
        row.splitOf && h('span', { class: 'muted small-text' }, `part ${row.splitIndex + 1} of a ${fmt(row.splitParent.cents)} transaction`)),
      amountBox),
    h('div', { class: 'tx-controls' }, controls,
      !isComplete(row) && h('span', { class: 'chip' }, `⚑ Choose ${row.cat ? 'a subcategory' : 'a category and subcategory'} to save`),
      isComplete(row) && row.needsReview && h('span', { class: 'chip' }, '⚑ Check'),
      canConfirm && h('button', { class: 'ghost small', onclick: () => commit({}) }, 'Looks right'),
      row.kind === 'expense' && row.cents > 0 && !row.splitOf && h('button', { class: 'ghost small push', onclick: () => splitDialog(row, ctx) }, 'Split'),
      row.splitOf && h('button', { class: 'ghost small push', onclick: () => splitDialog(row, ctx) }, 'Edit split'),
      row.splitOf && h('button', { class: 'ghost small', onclick: () => ctx.unsplit(row) }, 'Undo split'),
      (!row.splitOf || ctx !== pendingCtx) && h('button', { class: 'ghost small del', 'aria-label': `Delete ${row.desc}`, onclick: () => ctx.remove(row) }, 'Delete')));
  ctx.els.set(row.id, el);
  return el;
}

function splitDialog(row, ctx) {
  const parent = row.splitOf ? row.splitParent : row;
  const siblings = row.splitOf ? ctx.siblings(row) : [];
  const parts = row.splitOf
    ? siblings.map(s => ({ desc: s.desc, amount: (s.cents / 100).toFixed(2), cat: s.cat, sub: s.sub, kind: s.kind }))
    : [{ desc: parent.desc, amount: '', cat: parent.cat, sub: parent.sub }, { desc: parent.desc, amount: '', cat: '', sub: '' }];
  const centsOf = part => (/-|\(/.test(part.amount) ? null : parseAmount(part.amount));

  return dialog(close => {
    const list = h('div', { class: 'split-list' });
    const summary = h('p', { class: 'split-summary', id: 'split-summary' });
    const assigned = () => parts.reduce((sum, p) => sum + (centsOf(p) || 0), 0);
    const valid = () => parts.length >= 2 && assigned() === parent.cents
      && parts.every(p => p.desc.trim() && centsOf(p) > 0 && isComplete({ kind: p.kind || 'expense', cat: p.cat, sub: p.sub }));
    const save = h('button', { class: 'primary', id: 'split-save', onclick: async () => {
      if (!valid()) return;
      await ctx.split(parent, parts.map(p => ({ desc: p.desc.replace(/\s+/g, ' ').trim(), cents: centsOf(p), cat: p.cat, sub: p.sub, kind: p.kind || 'expense' })), siblings);
      close(true);
    } }, 'Save split');
    const refresh = () => {
      const left = parent.cents - assigned();
      summary.textContent = `Total ${fmt(parent.cents)} · assigned ${fmt(assigned())} · ${left === 0 ? 'fully assigned' : left > 0 ? `${fmt(left)} left` : `${fmt(-left)} too much`}`;
      summary.classList.toggle('over', left < 0);
      save.disabled = !valid();
    };
    const draw = () => {
      list.replaceChildren(...parts.map((part, i) => {
        const n = i + 1;
        const cats = ctx.categories();
        const names = Object.keys(cats).filter(c => c !== 'Savings' || part.cat === 'Savings');
        const subs = cats[part.cat] || [];
        const pickCat = async value => {
          let cat = value;
          if (value === NEW) {
            cat = await askText('New category');
            if (!cat) return draw();
            if (!ctx.categories()[cat]) await ctx.addCategory(cat);
          }
          const choices = ctx.categories()[cat] || [];
          Object.assign(part, { cat, sub: choices.length === 1 ? choices[0] : '', kind: cat === 'Savings' ? 'savings' : 'expense' });
          draw(); refresh();
        };
        const pickSub = async value => {
          let sub = value;
          if (value === NEW) {
            sub = await askText(`New subcategory of ${part.cat}`);
            if (!sub) return draw();
            await ctx.addSub(part.cat, sub);
          }
          part.sub = sub;
          draw(); refresh();
        };
        return h('div', { class: 'split-part' },
          h('input', { class: 'split-desc', value: part.desc, 'aria-label': `Part ${n} description`, maxlength: 200, autocomplete: 'off', oninput: e => { part.desc = e.target.value; refresh(); } }),
          h('input', { class: 'split-amount', value: part.amount, inputmode: 'decimal', placeholder: '0.00', 'aria-label': `Part ${n} amount`, autocomplete: 'off', oninput: e => { part.amount = e.target.value; refresh(); } }),
          h('button', { class: 'ghost small', 'aria-label': `Remove part ${n}`, disabled: parts.length <= 2, onclick: () => { parts.splice(i, 1); draw(); refresh(); } }, 'Remove'),
          select(`Part ${n} category`, part.cat, [['', 'Choose category…'], ...names, ...(part.cat && !cats[part.cat] ? [part.cat] : []), [NEW, '+ New category…']], pickCat, { class: part.cat ? '' : 'missing' }),
          select(`Part ${n} subcategory`, part.sub, [['', part.cat ? 'Choose subcategory…' : '—'], ...subs, ...(part.sub && !subs.includes(part.sub) ? [part.sub] : []), ...(part.cat ? [[NEW, '+ New subcategory…']] : [])], pickSub, { disabled: !part.cat, class: part.cat && !part.sub ? 'missing' : '' }));
      }));
    };
    draw();
    refresh();
    return h('div', { class: 'stack' },
      h('h2', {}, 'Split transaction'),
      h('p', { class: 'muted' }, `${parent.origDesc || parent.desc} · ${prettyDate(parent.date)}`),
      list,
      h('div', { class: 'row' },
        h('button', { class: 'ghost small', onclick: () => { parts.push({ desc: parent.desc, amount: '', cat: '', sub: '' }); draw(); refresh(); } }, '+ Add part'),
        h('button', { class: 'ghost small', onclick: () => {
          const last = parts[parts.length - 1];
          const others = parts.slice(0, -1).reduce((sum, p) => sum + (centsOf(p) || 0), 0);
          if (parent.cents - others > 0) last.amount = ((parent.cents - others) / 100).toFixed(2);
          draw(); refresh();
        } }, 'Put the rest in the last part')),
      summary,
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => close(null) }, 'Cancel'), save));
  });
}

function offerApplyToOthers(row, list, apply) {
  if (row.splitOf) return;
  const key = merchantOf(row);
  const sameMerchant = other => other === key || other.startsWith(`${key} `) || key.startsWith(`${other} `);
  const others = list.filter(r => r !== row && !r.edited && sameMerchant(merchantOf(r)) && (r.kind !== row.kind || r.cat !== row.cat || r.sub !== row.sub));
  if (!isComplete(row) || !others.length) return;
  toast(`Remembered for ${key}.`, { label: `Apply to ${others.length} other${others.length > 1 ? 's' : ''}`, run: () => apply(others) });
}

/* ---------- Import ---------- */

function newPending() {
  return { files: [], edits: new Map(), renames: new Map(), amounts: new Map(), splits: new Map(), removed: new Set(), rules: structuredClone(S.rules), rows: [], tab: 'review', els: new Map() };
}

function pendingCategories() {
  return S.pending?.files.find(f => f.workbook)?.categories || S.categories;
}

function rebuildPending() {
  const P = S.pending;
  const existing = new Set(S.tx.flatMap(r => (r.splitOf ? [r.id, r.splitOf] : [r.id]))); // A split row still counts as its original.
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
    if (P.renames.has(r.id)) applyRename(r, P.renames.get(r.id));
    if (P.amounts.has(r.id)) applyAmount(r, P.amounts.get(r.id));
  }
  P.rows = classified
    .flatMap(r => (P.splits.has(r.id) ? buildSplit(r, P.splits.get(r.id)) : [r]))
    .sort((a, b) => a.date.localeCompare(b.date));
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
  rename(row, next) {
    if (row.splitOf) S.pending.splits.get(row.splitOf)[row.splitIndex].desc = next;
    else S.pending.renames.set(row.id, next);
    applyRename(row, next);
  },
  setAmount(row, cents) {
    S.pending.amounts.set(row.id, cents);
    applyAmount(row, cents);
    updateImportCounts();
  },
  siblings: row => S.pending.rows.filter(r => r.splitOf === row.splitOf).sort((a, b) => a.splitIndex - b.splitIndex),
  split(parent, parts) {
    S.pending.splits.set(parent.id, parts);
    rebuildPending();
    render();
  },
  unsplit(row) {
    S.pending.splits.delete(row.splitOf);
    rebuildPending();
    render();
  },
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
    if (row.splitOf) {
      Object.assign(P.splits.get(row.splitOf)[row.splitIndex], { kind: row.kind, cat: row.cat, sub: row.sub });
      updateImportCounts();
      return;
    }
    P.edits.set(row.id, { desc: row.origDesc || row.desc, kind: row.kind, cat: row.cat, sub: row.sub });
    updateImportCounts();
    offerApplyToOthers(row, P.rows, others => {
      for (const r of others) {
        Object.assign(r, { kind: row.kind, cat: row.cat, sub: row.sub, needsReview: false, edited: true });
        P.edits.set(r.id, { desc: r.origDesc || r.desc, kind: r.kind, cat: r.cat, sub: r.sub });
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
  if (workbook) await saveCategories(withSavings(workbook.categories));

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
  S.month = latest; S.year = latest?.slice(0, 4); S.scope = 'month'; S.openCat = null;
  S.view = 'dashboard';
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

/* ---------- Transactions ---------- */

const txCtx = {
  els: new Map(),
  categories: () => S.categories,
  addCategory: async name => { await saveCategories({ ...S.categories, [name]: [] }); },
  addSub: async (cat, sub) => { await saveCategories({ ...S.categories, [cat]: [...(S.categories[cat] || []), sub] }); },
  async rename(row, next) {
    applyRename(row, next);
    // A half-finished category change on this row must not be saved along with the new wording.
    await store.putTx([{ ...row, ...S.drafts.get(row.id) }]);
    toast('Description saved.');
  },
  async setAmount(row, cents) {
    applyAmount(row, cents);
    await store.putTx([{ ...row, ...S.drafts.get(row.id) }]);
    updateTxCount();
    toast('Amount saved.');
  },
  siblings: row => S.tx.filter(r => r.splitOf === row.splitOf).sort((a, b) => a.splitIndex - b.splitIndex),
  async split(parent, parts, previous = []) {
    const children = buildSplit(parent, parts);
    const replaced = new Set([parent.id, ...previous.map(r => r.id)]);
    await store.deleteTx([...replaced]);
    await store.putTx(children);
    S.tx = [...S.tx.filter(r => !replaced.has(r.id)), ...children];
    replaced.forEach(id => S.drafts.delete(id));
    drawTxList();
    toast('Split saved.');
  },
  async unsplit(row) {
    const parts = txCtx.siblings(row);
    const ids = new Set(parts.map(r => r.id));
    await store.deleteTx([...ids]);
    await store.putTx([row.splitParent]);
    S.tx = [...S.tx.filter(r => !ids.has(r.id)), row.splitParent];
    ids.forEach(id => S.drafts.delete(id));
    drawTxList();
    toast('Split undone.');
  },
  beforeChange(row) {
    if (!S.drafts.has(row.id)) S.drafts.set(row.id, { kind: row.kind, cat: row.cat, sub: row.sub, needsReview: row.needsReview, edited: row.edited });
  },
  async remove(row) {
    if (S.drafts.has(row.id)) { Object.assign(row, S.drafts.get(row.id)); S.drafts.delete(row.id); }
    S.tx = S.tx.filter(r => r !== row);
    S.deleted.add(row.id);
    if (row.splitOf) S.deleted.add(row.splitOf); // Deleting every part must not let a re-import bring the original back.
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
    if (row.splitOf) return; // One part of a split says nothing about the merchant as a whole.
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
    (!f.month || r.date.startsWith(f.month))
    && (!f.account || r.account === f.account)
    && (!f.cat || (r.cat || UNCATEGORIZED) === f.cat)
    && (!q || r.desc.toLowerCase().includes(q) || (r.origDesc || '').toLowerCase().includes(q) || (r.sub || '').toLowerCase().includes(q))
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
  const sumOf = kind => rows.filter(r => r.kind === kind).reduce((s, r) => s + r.cents, 0);
  const expenses = rows.some(r => r.kind === 'expense');
  const savings = rows.some(r => r.kind === 'savings');
  const parts = [`${rows.length} shown`];
  if (expenses || !savings) parts.push(`${fmt(sumOf('expense'))} spending`);
  if (savings) parts.push(`${fmt(sumOf('savings'))} savings`);
  const label = document.querySelector('#tx-count');
  if (label) label.textContent = parts.join(' · ');
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

function addTransaction() {
  const today = localToday();
  const month = S.filter.month?.length === 7 ? S.filter.month : null; // A whole year has no single month to start in.
  const draft = { kind: 'expense', date: month && !today.startsWith(month) ? `${month}-01` : today, desc: '', amount: '', cat: '', sub: '', account: 'Cash' };
  const accounts = [...new Set(['Cash', ...S.tx.map(r => r.account).filter(a => a !== 'Spreadsheet')])];
  const cents = () => parseAmount(draft.amount);
  const valid = () => /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && draft.desc.trim() && !/-|\(/.test(draft.amount) && cents() > 0 && isComplete(draft) && (draft.kind === 'expense' || draft.sub);

  return dialog(close => {
    const add = h('button', { class: 'primary', id: 'add-confirm', disabled: true, onclick: async () => {
      if (!valid()) return;
      const row = {
        id: `Manual|${crypto.randomUUID()}`,
        account: draft.account,
        accountType: S.tx.find(r => r.account === draft.account)?.accountType || 'cash',
        date: draft.date,
        desc: draft.desc.trim(),
        cents: draft.kind === 'income' ? -cents() : cents(),
        bankCategory: '', bankType: '',
        kind: draft.kind, cat: draft.cat, sub: draft.sub,
        needsReview: false, edited: true,
      };
      await store.putTx([row]);
      S.tx.push(row);
      S.filter = { ...S.filter, month: monthOf(row) };
      pickDefaults();
      close(true);
      render();
      toast(`Added ${row.desc}.`);
    } }, 'Add transaction');
    const check = () => { add.disabled = !valid(); };
    const choices = h('div', { class: 'grid2' });

    const askNew = async (title, apply) => {
      const name = await askText(title);
      if (name) await apply(name);
      drawChoices();
      check();
    };
    const onCat = value => {
      if (value === NEW) {
        return askNew('New category', async name => {
          if (!S.categories[name]) await txCtx.addCategory(name);
          draft.cat = name; draft.sub = '';
        });
      }
      draft.cat = value;
      const subs = S.categories[value] || [];
      draft.sub = subs.length === 1 ? subs[0] : '';
      drawChoices(); check();
    };
    const onSub = value => {
      if (value === NEW) {
        return askNew(draft.kind === 'income' ? 'New income source' : `New subcategory of ${draft.cat}`, async name => {
          if (draft.kind !== 'income') await txCtx.addSub(draft.cat, name);
          draft.sub = name;
        });
      }
      draft.sub = value;
      check();
    };
    function drawChoices() {
      if (draft.kind === 'savings') {
        const subs = S.categories.Savings || [];
        choices.replaceChildren(h('label', { class: 'field' }, 'Savings subcategory',
          select('Savings subcategory', draft.sub, [['', 'Choose subcategory…'], ...subs, [NEW, '+ New subcategory…']], onSub)));
        return;
      }
      if (draft.kind === 'income') {
        const sources = incomeSources();
        choices.replaceChildren(h('label', { class: 'field' }, 'Income source',
          select('Income source', draft.sub, [...sources, ...(sources.includes(draft.sub) ? [] : [draft.sub]), [NEW, '+ New source…']], onSub)));
        return;
      }
      const subs = S.categories[draft.cat] || [];
      choices.replaceChildren(
        h('label', { class: 'field' }, 'Category', select('Category', draft.cat, [['', 'Choose category…'], ...Object.keys(S.categories).filter(c => c !== 'Savings'), [NEW, '+ New category…']], onCat)),
        h('label', { class: 'field' }, 'Subcategory', select('Subcategory', draft.sub, [['', draft.cat ? 'Choose subcategory…' : '—'], ...subs, ...(subs.includes(draft.sub) || !draft.sub ? [] : [draft.sub]), ...(draft.cat ? [[NEW, '+ New subcategory…']] : [])], onSub, { disabled: !draft.cat })));
    }
    drawChoices();

    return h('div', { class: 'stack' },
      h('h2', {}, 'Add transaction'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Date', h('input', { type: 'date', 'aria-label': 'Date', value: draft.date, oninput: e => { draft.date = e.target.value; check(); } })),
        h('label', { class: 'field' }, 'Amount', h('input', { inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount', autocomplete: 'off', oninput: e => { draft.amount = e.target.value; check(); } }))),
      h('label', { class: 'field' }, 'Description', h('input', { 'aria-label': 'Description', autocomplete: 'off', oninput: e => { draft.desc = e.target.value; check(); } })),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Type', select('Type', draft.kind, [['expense', 'Expense'], ['income', 'Income'], ['savings', 'Savings']], v => {
          draft.kind = v;
          const savingsSubs = S.categories.Savings || [];
          draft.cat = v === 'income' ? 'Income' : v === 'savings' ? 'Savings' : '';
          draft.sub = v === 'income' ? 'Other' : v === 'savings' && savingsSubs.length === 1 ? savingsSubs[0] : '';
          drawChoices(); check();
        })),
        h('label', { class: 'field' }, 'Account', select('Account', draft.account, accounts, v => { draft.account = v; }))),
      choices,
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => close(null) }, 'Cancel'), add));
  });
}

function viewTx() {
  const f = S.filter;
  const months = monthChoices(S.tx, localToday());
  const accounts = [...new Set(S.tx.map(r => r.account))].sort();
  const set = key => v => { f[key] = v; f.limit = 100; drawTxList(); };
  setTimeout(drawTxList);
  return [
    h('div', { class: 'row between title' }, h('h1', {}, 'Transactions'), h('button', { class: 'primary', id: 'add-tx', onclick: addTransaction }, '+ Add transaction')),
    h('div', { class: 'filters' },
      h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search transactions', value: f.q || '', oninput: e => set('q')(e.target.value) }),
      select('Month', f.month || '', [['', 'All months'], ...[...new Set(months.map(m => m.slice(0, 4)))].map(y => [y, `All of ${y}`]), ...months.map(m => [m, monthLabel(m)])], set('month')),
      select('Account', f.account || '', [['', 'All accounts'], ...accounts], set('account')),
      select('Category', f.cat || '', [['', 'All categories'], ...Object.keys(S.categories), UNCATEGORIZED], set('cat')),
      select('Show', f.show || '', [['', 'Everything'], ['review', 'Needs a look'], ['expense', 'Expenses'], ['income', 'Income'], ['savings', 'Savings'], ['transfer', 'Not counted']], set('show'))),
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
    S.view = 'dashboard';
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

async function removeCategory(name) {
  const { [name]: removed, ...rest } = S.categories;
  await saveCategories(rest);
  if (S.budgets[name]) {
    const { [name]: dropped, ...budgets } = S.budgets;
    S.budgets = budgets;
    await store.setKv('budgets', budgets);
  }
  render();
  toast(`Removed ${name}.`);
}

function unusedCategories() {
  const used = new Set(S.tx.map(r => r.cat));
  const names = Object.keys(S.categories).filter(c => c !== 'Savings' && !used.has(c));
  if (!names.length) return null;
  return h('section', { class: 'card stack' }, h('h2', {}, 'Unused categories'),
    h('p', { class: 'muted' }, 'No transaction uses these. You can add a category again from any transaction.'),
    names.map(name => h('div', { class: 'row between line' }, h('span', {}, name),
      h('button', { class: 'ghost small', 'aria-label': `Remove ${name}`, onclick: () => removeCategory(name) }, 'Remove'))));
}

const showRecoveryCode = code => dialog(close => {
  const copy = h('button', { class: 'ghost', onclick: async () => {
    try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed. Write it down.'; }
  } }, 'Copy');
  return h('div', { class: 'stack' },
    h('h2', {}, 'Save your recovery code'),
    h('p', {}, 'If your passkey ever stops working, this code gets you back in on this device. It won’t be shown again.'),
    h('code', { class: 'recovery-code', id: 'recovery-code' }, code),
    h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => close(false) }, 'Cancel'), copy, h('button', { class: 'primary', id: 'lock-confirm', onclick: () => close(true) }, 'I saved it')));
});

async function turnOnLock() {
  let credentialId;
  try {
    credentialId = await lock.createPasskey();
  } catch {
    return toast('The lock was not turned on.');
  }
  const code = lock.newRecoveryCode();
  if (await showRecoveryCode(code)) {
    await lock.turnOn(credentialId, code);
    toast('Lock turned on.');
  } else {
    toast('The lock was not turned on.');
  }
  render();
}

async function turnOffLock() {
  try {
    await lock.turnOff();
  } catch {
    return toast('The lock is still on.');
  }
  render();
  toast('Lock turned off.');
}

function lockCard() {
  const on = lock.isOn();
  return h('section', { class: 'card stack', id: 'lock-card' }, h('h2', {}, 'App lock'),
    h('p', {}, on
      ? `On for this device. It asks for Face ID, a fingerprint or your device passcode when the app opens, and after ${lock.LOCK_AFTER_MINUTES} minutes away.`
      : 'Ask for Face ID, a fingerprint or your device passcode before showing your data. This is set separately on each device.'),
    h('p', { class: 'muted' }, 'The lock keeps people out of the app. It doesn’t encrypt the data stored on this device.'),
    on ? h('button', { class: 'ghost', id: 'lock-off', onclick: turnOffLock }, 'Turn off lock')
      : lock.isSupported() ? h('button', { class: 'primary', id: 'lock-on', onclick: turnOnLock }, 'Turn on lock')
        : h('p', { class: 'muted' }, 'This browser or device can’t use a passkey lock.'));
}

function viewData() {
  const restore =h('input', { type: 'file', hidden: true, accept: '.backup,application/octet-stream,*/*', onchange: e => { if (e.target.files[0]) restoreBackup(e.target.files[0]); e.target.value = ''; } });
  const install = window.__installPrompt && h('button', { class: 'primary', onclick: async () => { window.__installPrompt.prompt(); window.__installPrompt = null; render(); } }, 'Install this app');
  return [
    h('h1', {}, 'Data'),
    h('section', { class: 'card stack' }, h('h2', {}, 'Backup and other devices'),
      h('p', {}, 'Your data lives only in this browser. A backup is an encrypted file you can keep in OneDrive and open on your phone.'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: makeBackup }, 'Save backup'), h('button', { class: 'ghost', onclick: () => restore.click() }, 'Restore backup'), restore),
      install),
    lockCard(),
    h('section', { class: 'card stack' }, h('h2', {}, 'Import history'),
      S.batches.length ? S.batches.map(b => h('div', { class: 'row between line' },
        h('div', {}, h('div', {}, b.files.join(', ')), h('span', { class: 'muted' }, `${prettyDate(b.at.slice(0, 10))} · ${S.tx.filter(r => r.batch === b.id).length} transactions`)),
        h('button', { class: 'ghost small', onclick: () => undoBatch(b) }, 'Undo'))) : h('p', { class: 'muted' }, 'Nothing imported yet.')),
    unusedCategories(),
    h('section', { class: 'card stack' }, h('h2', {}, 'Export'),
      h('button', { class: 'ghost', onclick: () => {
        const lines = [['Date', 'Description', 'Amount', 'Type', 'Category', 'Subcategory', 'Account'].join(',')];
        for (const r of [...S.tx].sort((a, b) => a.date.localeCompare(b.date))) lines.push([r.date, r.desc, ((r.kind === 'income' ? -r.cents : r.cents) / 100).toFixed(2), r.kind, r.cat, r.sub, r.account].map(csvCell).join(','));
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

function editBudgets() {
  const typical = typicalMonthly(S.tx);
  const names = Object.keys(S.categories).filter(c => c !== 'Savings');
  const values = Object.fromEntries(names.map(c => [c, S.budgets[c] ? String(S.budgets[c] / 100) : '']));
  const parse = text => {
    const t = text.trim();
    if (!t) return 0;
    return /-|\(/.test(t) ? null : parseAmount(t);
  };

  return dialog(close => {
    const inputs = new Map();
    const summary = h('p', { class: 'muted', id: 'budget-total' });
    const save = h('button', { class: 'primary', id: 'budgets-save', onclick: async () => {
      const next = {};
      for (const [name, text] of Object.entries(values)) {
        const cents = parse(text);
        if (cents > 0) next[name] = cents;
      }
      S.budgets = next;
      await store.setKv('budgets', next);
      close(true);
      render();
      toast('Budgets saved.');
    } }, 'Save budgets');
    const update = () => {
      const parsed = Object.values(values).map(parse);
      const invalid = parsed.includes(null);
      save.disabled = invalid;
      if (invalid) { summary.textContent = 'Budgets must be positive amounts.'; return; }
      const total = parsed.reduce((a, b) => a + b, 0);
      summary.textContent = `Total ${fmt(total)} a month${typical.income > 0 ? ` · typical income ${fmt(typical.income)} · leaves ${fmt(typical.income - total)}` : ''}`;
    };
    const rows = names.map(name => {
      const input = h('input', { inputmode: 'decimal', placeholder: '0', autocomplete: 'off', 'aria-label': `Budget for ${name}`, value: values[name], oninput: e => { values[name] = e.target.value; update(); } });
      inputs.set(name, input);
      return h('label', { class: 'budget-row' }, h('span', { class: 'budget-name' }, name), h('span', { class: 'muted small-text' }, typical.categories[name] ? `typical ${fmt(typical.categories[name])}` : ''), input);
    });
    const fill = h('button', { class: 'ghost small', onclick: () => {
      for (const name of names) {
        const rounded = Math.round((typical.categories[name] || 0) / 1000) * 10;
        if (values[name].trim() || rounded <= 0) continue;
        values[name] = String(rounded);
        inputs.get(name).value = values[name];
      }
      update();
    } }, 'Fill blanks with typical amounts');
    update();
    return h('div', { class: 'stack' },
      h('h2', {}, 'Monthly budgets'),
      h('p', { class: 'muted' }, 'Leave a category blank if you don’t want to track it. “Typical” is your middle month.'),
      fill,
      h('div', { class: 'budget-list' }, rows),
      summary,
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => close(null) }, 'Cancel'), save));
  });
}

const dashboardActions = {
  editBudgets,
  render: () => render(),
  goTx: filter => { S.filter = filter; S.view = 'tx'; render(); window.scrollTo(0, 0); },
  goImport: () => { S.view = 'import'; render(); },
};
const VIEWS = { dashboard: () => viewDashboard(S, dashboardActions), tx: viewTx, import: viewImport, data: viewData };

function render() {
  revertDrafts();
  main.classList.toggle('wide', S.view === 'dashboard');
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

/** Moves saved data to the current category list once, keeping a copy of how it was. */
async function upgradeCategories() {
  const from = await store.getKv('taxonomy') || 1;
  if (from >= TAXONOMY) return;
  const before = {
    tx: await store.allTx(),
    rules: await store.getKv('rules'),
    categories: await store.getKv('categories'),
    budgets: await store.getKv('budgets'),
  };
  const hasData = before.tx.length || before.categories;
  if (hasData && from < 2) {
    await store.setKv('beforeTaxonomy2', before);
    const after = migrateData(before);
    await store.putTx(after.tx);
    await store.setKv('rules', after.rules);
    await store.setKv('categories', after.categories);
    await store.setKv('budgets', after.budgets);
  } else if (hasData) {
    await store.setKv('rules', pinMixedStores(before.rules || {}));
  }
  await store.setKv('taxonomy', TAXONOMY);
}

async function loadAll() {
  await upgradeCategories();
  S.tx = await store.allTx();
  S.rules = await store.getKv('rules') || {};
  S.categories = withSavings(await store.getKv('categories') || structuredClone(DEFAULT_CATEGORIES));
  S.profiles = await store.getKv('profiles') || [];
  S.batches = await store.getKv('batches') || [];
  S.deleted = new Set(await store.getKv('deleted') || []);
  S.budgets = await store.getKv('budgets') || {};
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
  if (!lock.isLocked()) addFiles(e.dataTransfer.files);
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; if (S.view === 'data') render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

await lock.init();
await lock.untilUnlocked(); // Nothing is read from storage until this passes.
await loadAll();
if (!S.tx.length) S.view = 'import';
render();
