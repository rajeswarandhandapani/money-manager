// Reads the existing MonthlyExpense.xlsx using only browser built-ins, so the app
// carries no third-party code near financial data. An .xlsx file is a zip of XML.

import { excelSerialToIso, parseDate, parseAmount } from './parse.js';

async function unzip(buffer) {
  const view = new DataView(buffer);
  let end = buffer.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('This is not a valid .xlsx file.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, at + 46, nameLen));
    files.set(name, { method, compressed, local });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return async name => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + view.getUint16(f.local + 26, true) + view.getUint16(f.local + 28, true);
    const bytes = new Uint8Array(buffer, start, f.compressed);
    if (f.method === 0) return decoder.decode(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

const xml = text => new DOMParser().parseFromString(text, 'application/xml');
const byTag = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
const colIndex = ref => [...ref.replace(/\d/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function sheetRows(doc, strings) {
  const rows = [];
  for (const r of byTag(doc, 'row')) {
    const cells = [];
    for (const c of byTag(r, 'c')) {
      const type = c.getAttribute('t');
      const v = byTag(c, 'v')[0]?.textContent;
      let value = v ?? '';
      if (type === 's') value = strings[+v] ?? '';
      else if (type === 'inlineStr') value = byTag(c, 't').map(t => t.textContent).join('');
      cells[colIndex(c.getAttribute('r'))] = value;
    }
    rows.push(cells);
  }
  return rows;
}

function readDate(value) {
  if (/^\d+(\.\d+)?$/.test(String(value))) return excelSerialToIso(value);
  return parseDate(value);
}

function table(rows) {
  const headers = (rows[0] || []).map(h => String(h ?? '').trim());
  return { at: Object.fromEntries(headers.map((h, i) => [h, i])), body: rows.slice(1) };
}

const toCents = value => {
  const n = parseAmount(value);
  if (n === null) return null;
  const f = parseFloat(value);
  return Number.isFinite(f) ? Math.round(f * 100) : n;
};

/** Returns { categories, rows } in the same standard shape as a bank import. */
export async function readWorkbook(buffer) {
  const read = await unzip(buffer);
  const book = xml(await read('xl/workbook.xml'));
  const rels = xml(await read('xl/_rels/workbook.xml.rels'));
  const sharedText = await read('xl/sharedStrings.xml');
  const strings = sharedText ? byTag(xml(sharedText), 'si').map(si => byTag(si, 't').map(t => t.textContent).join('')) : [];
  const targets = Object.fromEntries(byTag(rels, 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));

  const sheets = {};
  for (const s of byTag(book, 'sheet')) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    sheets[s.getAttribute('name')] = targets[rid].replace(/^\/?(xl\/)?/, 'xl/');
  }
  for (const needed of ['Categories', 'Transactions']) {
    if (!sheets[needed]) throw new Error(`This workbook has no "${needed}" sheet.`);
  }
  const load = async name => sheets[name] ? sheetRows(xml(await read(sheets[name])), strings) : [];

  const catRows = await load('Categories');
  const categories = {};
  (catRows[0] || []).forEach((name, col) => {
    if (!name) return;
    categories[name] = catRows.slice(1).map(r => r[col]).filter(Boolean);
  });

  const rows = [];
  const seen = new Map();
  const add = row => {
    const base = `Spreadsheet|${row.date}|${row.cents}|${row.desc.toUpperCase()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    rows.push({ ...row, id: `${base}|${n}`, account: 'Spreadsheet', accountType: 'history', bankCategory: '', bankType: '', needsReview: false, edited: false });
  };

  const tx = table(await load('Transactions'));
  for (const r of tx.body) {
    const date = readDate(r[tx.at.Date]);
    const cents = toCents(r[tx.at.Amount]);
    if (!date || cents === null) continue;
    add({ date, cents, desc: String(r[tx.at.Description] ?? '').trim() || '(no description)', kind: 'expense', cat: r[tx.at.Category] || '', sub: r[tx.at.Subcategory] || '' });
  }
  const inc = table(await load('Income'));
  for (const r of inc.body) {
    const date = readDate(r[inc.at.Date]);
    const cents = toCents(r[inc.at.Amount]);
    if (!date || cents === null) continue;
    add({ date, cents: -cents, desc: String(r[inc.at.Description] ?? '').trim() || '(no description)', kind: 'income', cat: 'Income', sub: r[inc.at.Source] || 'Other' });
  }
  return { categories, rows };
}
