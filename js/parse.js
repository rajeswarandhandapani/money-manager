// Turns a bank export into one standard row shape. Nothing here touches the page
// or storage, so it can be tested directly in Node.
//
// Standard row: { account, accountType, date: 'YYYY-MM-DD', desc, cents, bankCategory, bankType, id }
// cents is an integer: positive = money leaving you, negative = money arriving.

export const PROFILES = [
  {
    id: 'pnc-checking', account: 'PNC Checking', accountType: 'checking',
    headers: ['transaction date', 'transaction description', 'amount', 'category'],
    date: 'Transaction Date', desc: 'Transaction Description',
    amountMode: 'signed', amount: 'Amount', spendSign: -1, category: 'Category',
  },
  {
    id: 'chase-card', account: 'Chase Credit Card', accountType: 'card',
    headers: ['transaction date', 'post date', 'description', 'category', 'type', 'amount', 'memo'],
    date: 'Transaction Date', desc: 'Description',
    amountMode: 'signed', amount: 'Amount', spendSign: -1, category: 'Category', type: 'Type',
  },
  {
    id: 'capone-card', account: 'Capital One Credit Card', accountType: 'card',
    headers: ['transaction date', 'posted date', 'card no.', 'description', 'category', 'debit', 'credit'],
    date: 'Transaction Date', desc: 'Description',
    amountMode: 'debitCredit', debit: 'Debit', credit: 'Credit', category: 'Category', cardColumn: 'Card No.',
  },
  {
    id: 'pnc-card', account: 'PNC Credit Card', accountType: 'card',
    headers: ['date', 'description', 'amount'],
    date: 'Date', desc: 'Description',
    amountMode: 'signed', amount: 'Amount', spendSign: 1,
  },
];

/** Reads CSV text, including quoted commas and line breaks. Also accepts tab or semicolon files. */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQuote = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch in counts) counts[ch]++;
  }
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

const norm = s => String(s ?? '').trim().toLowerCase();
const sameHeaders = (row, headers) =>
  row.length >= headers.length && row.slice(0, headers.length).every((c, i) => norm(c) === headers[i])
  && row.slice(headers.length).every(c => norm(c) === '');

/** Accepts - $1413.82, $-151.16, $42.5, (45.00), 1,234.56 and 45.00 CR. Returns signed cents, or null. */
export function parseAmount(value) {
  const s = String(value ?? '').trim();
  if (!/\d/.test(s)) return null;
  const digits = s.replace(/[^0-9.]/g, '');
  if (!/^\d*\.?\d*$/.test(digits)) return null;
  const size = Math.round(parseFloat(digits) * 100);
  if (!Number.isFinite(size)) return null;
  const negative = /-|−|\(.*\)|\bCR\b/i.test(s);
  return negative ? -size : size;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
function iso(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Excel stores dates as a day count from 1899-12-30. */
export function excelSerialToIso(serial) {
  const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(serial)) * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Decides month-first or day-first from the whole column, so one ambiguous row can't mislead it. */
export function dateOrder(values) {
  let dayFirst = false;
  let monthFirst = false;
  for (const v of values) {
    const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(String(v));
    if (!m) continue;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
  }
  return dayFirst && !monthFirst ? 'dmy' : 'mdy';
}

export function parseDate(value, order = 'mdy') {
  const s = String(value ?? '').trim();
  let m;
  if ((m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(s))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s))) {
    return order === 'dmy' ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  }
  if ((m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(s)) && MONTHS[m[1].toLowerCase()]) {
    return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  }
  if ((m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/.exec(s)) && MONTHS[m[2].toLowerCase()]) {
    return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(s);
  return null;
}

/** Finds the column-title row, skipping any summary lines a bank puts above it. */
export function findHeaderRow(rows, profiles) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const profile = profiles.find(p => sameHeaders(rows[i], p.headers));
    if (profile) return { index: i, profile };
  }
  const width = Math.max(0, ...rows.slice(0, 15).map(r => r.length));
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i];
    if (r.length === width && r.filter(c => c.trim()).length >= 2 && !r.some(c => parseAmount(c) !== null && /^[\s$()\-+\d.,]+$/.test(c))) {
      return { index: i, profile: null };
    }
  }
  return { index: 0, profile: null };
}

/** First guess at the columns of a format the app hasn't seen. The person confirms it on screen. */
export function guessMapping(headers) {
  const find = (...patterns) => {
    for (const p of patterns) {
      const hit = headers.find(h => p.test(norm(h)));
      if (hit) return hit;
    }
    return '';
  };
  const debit = find(/^debit/, /withdrawal/, /money out/);
  const credit = find(/^credit$/, /^credits?\b/, /deposit/, /money in/);
  const amount = find(/^(transaction )?amount/, /^amt/);
  return {
    date: find(/^(transaction|trans\.?) date/, /^date/, /date/),
    desc: find(/description/, /merchant/, /payee/, /details/, /memo/, /name/),
    amountMode: amount || !(debit && credit) ? 'signed' : 'debitCredit',
    amount, debit, credit, type: '',
    spendSign: -1,
    category: find(/categor/),
    account: '', accountType: 'card',
  };
}

function accountNameFor(profile, fileName) {
  const last4 = profile.id === 'chase-card' && /chase\s*(\d{4})/i.exec(fileName || '');
  return last4 ? `${profile.account} ${last4[1]}` : profile.account;
}

function centsFor(cells, map, at) {
  if (map.amountMode === 'debitCredit') {
    const out = parseAmount(cells[at[map.debit]]);
    const inn = parseAmount(cells[at[map.credit]]);
    if (out === null && inn === null) return null;
    return Math.abs(out || 0) - Math.abs(inn || 0);
  }
  const raw = parseAmount(cells[at[map.amount]]);
  if (raw === null) return null;
  if (map.amountMode === 'amountType') {
    const t = norm(cells[at[map.type]]);
    return /debit|withdraw|sale|purchase|^dr$/.test(t) ? Math.abs(raw) : -Math.abs(raw);
  }
  return raw * map.spendSign;
}

/**
 * Applies a mapping to the rows of one file.
 * Identical rows in a file are numbered so that two same-day $2.75 fares both survive,
 * while importing an overlapping export again still produces the same ids.
 */
export function normalizeRows(dataRows, headers, map) {
  const at = Object.fromEntries(headers.map((h, i) => [h, i]));
  const order = dateOrder(dataRows.map(r => r[at[map.date]]));
  const seen = new Map();
  const rows = [];
  const problems = [];
  dataRows.forEach((cells, i) => {
    const date = parseDate(cells[at[map.date]], order);
    const cents = centsFor(cells, map, at);
    const desc = String(cells[at[map.desc]] ?? '').replace(/\s+/g, ' ').trim();
    if (!date || cents === null || !desc) {
      problems.push({ line: i + 1, text: cells.join(', ') });
      return;
    }
    const card = map.cardColumn ? String(cells[at[map.cardColumn]] ?? '').trim() : '';
    const account = card ? `${map.account} ${card}` : map.account;
    const base = `${account}|${date}|${cents}|${desc.toUpperCase()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    rows.push({
      id: `${base}|${n}`,
      account,
      accountType: map.accountType,
      date, desc, cents,
      bankCategory: map.category ? String(cells[at[map.category]] ?? '').trim() : '',
      bankType: map.type ? String(cells[at[map.type]] ?? '').trim() : '',
    });
  });
  return { rows, problems };
}

/** Reads one file's text. `known` is any format the person has already confirmed. */
export function readExport(text, fileName, known = []) {
  const all = parseCsv(text);
  const { index, profile } = findHeaderRow(all, [...known, ...PROFILES]);
  const headers = (all[index] || []).map(h => h.trim());
  const dataRows = all.slice(index + 1);
  const signature = headers.map(norm).join('|');
  if (!profile) {
    return { fileName, recognized: false, headers, dataRows, signature, map: guessMapping(headers), rows: [], problems: [] };
  }
  const map = { ...profile, account: profile.custom ? profile.account : accountNameFor(profile, fileName) };
  return { fileName, recognized: true, headers, dataRows, signature, map, ...normalizeRows(dataRows, headers, map) };
}

/** True when a card file looks backwards: on a card, most rows should be spending. */
export function looksFlipped(rows, accountType) {
  if (accountType !== 'card' || rows.length < 3) return false;
  return rows.filter(r => r.cents < 0).length > rows.length / 2;
}
