// Decides what each transaction is: an expense in which category, income, or a
// transfer that must not count. Learns from the person's own corrections.

export const DEFAULT_CATEGORIES = {
  Housing: ['Rent', 'Electricity', 'Gas', 'Water & Sewer', 'Internet', 'Phone', 'Renters Insurance'],
  Food: ['Groceries', 'Snacks & Ice Cream', 'Temple Food'],
  Dining: ['Restaurants', 'Fast Food', 'Coffee & Tea'],
  Household: ['Supplies', 'Toiletries & Skincare', 'Mixed Store Run', 'Home & Garden', 'Furniture', 'Electronics', 'Office & Postage'],
  Clothing: ['Adult Clothing & Shoes', 'Kids Clothing & Shoes'],
  'Personal Care': ['Haircuts'],
  Children: ['School', 'Classes', 'Sports Gear', 'Toys', 'Birthday Parties'],
  Transport: ['Fuel', 'Bus', 'Parking & Tolls'],
  Car: ['Service & Repairs', 'Auto Insurance', 'Registration'],
  Health: ['Doctor & Dental', 'Pharmacy', 'HSA Contribution', 'Health Insurance', 'Dental Insurance', 'Life Insurance'],
  Wellness: ['Gym'],
  'Vacation & Travel': ['Flights', 'Hotels', 'Rental Cars', 'Food', 'Parking & Tolls', 'Attractions', 'Camping', 'Souvenirs'],
  Entertainment: ['Local Outings', 'Streaming', 'Games', 'Movies', 'Play Centers'],
  'Gifts & Giving': ['Birthdays', 'Gifts', 'Donations'],
  'Work & Education': ['Certifications', 'Courses & Books', 'Software', 'Website', 'Resume'],
  'Government & Legal': ['Visa', 'Passport', 'Licenses & IDs', 'Tax Filing'],
  Savings: ['India Remittance'],
};

/** Expenses and savings can't be saved without both. Income and "Not counted" rows don't use them. */
export const isComplete = row => (row.kind !== 'expense' && row.kind !== 'savings') || Boolean(row.cat && row.sub);

const PERSON_PAYMENT =/^(ZELLE|VENMO|CASH APP|CASHAPP|PAYPAL)\b/;
const NOISE = new Set(['ACH', 'WEB', 'RECUR', 'DEBIT', 'PMTS', 'PMT', 'POS', 'THE', 'INC', 'LLC']);

/** Reduces a bank description to a stable merchant name by dropping store numbers and reference codes. */
export function merchantKey(desc) {
  const words = String(desc || '').toUpperCase()
    .replace(/['’]/g, '')
    .split(/[^A-Z0-9]+/)
    .filter(w => w && !/\d/.test(w) && !/^X+$/.test(w) && !NOISE.has(w));
  return words.join(' ');
}

/** Always the bank's wording, so a description you reworded still matches next month's export. */
export const merchantOf = row => merchantKey(row.origDesc || row.desc);

const CARD_PAYMENT =/CRCARDPMT|CREDIT CRD AUTOPAY|CARDMEMBER SERV|CITI AUTOPAY|AUTOMATIC PAYMENT|THANK YOU FOR YOUR PMT|PAYMENT,? THANK YOU|CAPITAL ONE (MOBILE|ONLINE) PMT|AUTOPAY (PAYMENT|PYMT)/i;

export function isCardPayment(row) {
  if (/^credit card payments?$/i.test(row.bankCategory || '')) return true;
  if (/^payment$/i.test(row.bankType || '')) return true;
  return CARD_PAYMENT.test(row.desc);
}

/** Banks' own labels, used only as a low-confidence starting point for unknown merchants. */
const BANK_HINTS = {
  gas: ['Transport', 'Fuel'],
  groceries: ['Food', 'Groceries'],
  'food & drink': ['Dining', 'Restaurants'],
  'food and drink': ['Dining', 'Restaurants'],
  dining: ['Dining', 'Restaurants'],
  restaurants: ['Dining', 'Restaurants'],
  utilities: ['Housing', 'Electricity'],
  cable: ['Housing', 'Internet'],
};

/** Adds one transaction to the learned merchant list. A manual choice always wins afterwards. */
export function learn(rules, row, { manual = false } = {}) {
  const key = merchantOf(row);
  if (!key) return null;
  const rule = rules[key] || (rules[key] = { key, votes: {}, manual: null });
  if (rule.storeDefault) return rule;
  if (manual) {
    const next = { kind: row.kind, cat: row.cat || '', sub: row.sub || '', rowId: row.id };
    // Different choices on different rows (Amazon, say) mean the merchant varies: keep asking.
    const prev = rule.manual;
    if (prev && prev.rowId !== row.id && prev.sub && (prev.kind !== next.kind || prev.cat !== next.cat || prev.sub !== next.sub)) {
      rule.mixed = true;
    }
    rule.manual = next;
  } else if (row.kind === 'expense' && row.cat) {
    const v = `${row.cat}\u0000${row.sub || ''}`;
    rule.votes[v] = (rule.votes[v] || 0) + 1;
  }
  return rule;
}

function tally(entries) {
  const votes = {};
  for (const e of entries) for (const [v, n] of Object.entries(e.votes)) votes[v] = (votes[v] || 0) + n;
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const [top, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const [cat, sub] = top.split('\u0000');
  return { cat, sub, share: n / total };
}

/** Looks up a merchant: exact name, then a shorter or longer form, then the same first word. */
export function suggest(rules, desc) {
  const key = merchantKey(desc);
  if (!key) return null;
  const exact = rules[key];
  if (exact?.manual) return { ...exact.manual, sure: !exact.mixed };

  // What a payment to a person was for varies, and other people's payments say nothing about it.
  if (PERSON_PAYMENT.test(key)) {
    const t = exact ? tally([exact]) : null;
    return t ? { kind: 'expense', cat: t.cat, sub: t.sub, sure: false } : null;
  }

  const all = Object.values(rules);
  const words = key.split(' ');
  let matches = exact ? [exact] : [];
  let sureWhenClear = true;

  if (!matches.length) {
    for (let n = words.length - 1; n >= 1 && !matches.length; n--) {
      if (n === 1 && words[0].length < 4) break;
      const shorter = rules[words.slice(0, n).join(' ')];
      if (shorter) matches = [shorter];
    }
    if (matches[0]?.manual) return { ...matches[0].manual, sure: !matches[0].mixed };
  }
  if (!matches.length) matches = all.filter(r => r.key.startsWith(`${key} `));
  if (!matches.length && words[0].length >= 5) {
    matches = all.filter(r => r.key.split(' ')[0] === words[0]);
    sureWhenClear = false;
  }
  const manual = matches.find(m => m.manual);
  if (manual && matches.every(m => !m.manual || m.manual.cat === manual.manual.cat)) {
    return { ...manual.manual, sure: sureWhenClear && !manual.mixed };
  }
  const t = tally(matches);
  if (!t) return null;
  return { kind: 'expense', cat: t.cat, sub: t.sub, sure: sureWhenClear && t.share >= 0.75 };
}

/** Changes the amount but remembers the bank's figure. The row's id stays, so duplicates are still caught. */
export function applyAmount(row, cents) {
  const original = row.origCents ?? row.cents;
  if (row.id.startsWith('Manual|') || cents === original) delete row.origCents;
  else row.origCents = original;
  row.cents = cents;
}

/**
 * Turns one transaction into parts. Each part keeps the original row, so the split can be
 * undone and a re-import of the same bank file still recognizes it.
 */
export function buildSplit(parent, parts) {
  const { splitParent, ...snapshot } = parent;
  const bankText = parent.origDesc || parent.desc;
  return parts.map((part, i) => {
    const child = {
      ...snapshot,
      id: `${parent.id}|split|${i + 1}`,
      desc: part.desc, cents: part.cents, kind: part.kind || 'expense', cat: part.cat, sub: part.sub,
      needsReview: false, edited: true,
      splitOf: parent.id, splitIndex: i, splitParent: snapshot,
    };
    delete child.origCents;
    if (!parent.id.startsWith('Manual|') && part.desc !== bankText) child.origDesc = bankText;
    else delete child.origDesc;
    return child;
  });
}

/** Fills in kind, category and whether the person should look at this row. */
export function classify(row, rules, categories) {
  const learned = suggest(rules, row.desc);
  if (learned?.sure && learned.kind) return finish(row, learned.kind, learned.cat, learned.sub, false);
  if (isCardPayment(row)) return finish(row, 'transfer', '', '', false);
  if (row.cents < 0 && row.accountType === 'card' && /CASH ?BACK|REWARD/i.test(row.desc)) {
    return finish(row, 'income', 'Income', 'Cash back', true);
  }

  if (row.cents < 0 && row.accountType === 'checking') {
    return finish(row, 'income', 'Income', 'Other', true);
  }
  if (learned) return finish(row, learned.kind || 'expense', learned.cat, learned.sub, !learned.sure);

  const hint = BANK_HINTS[(row.bankCategory || '').toLowerCase()];
  if (hint && categories[hint[0]]?.includes(hint[1])) return finish(row, 'expense', hint[0], hint[1], true);
  return finish(row, 'expense', '', '', true);
}

function finish(row, kind, cat, sub, needsReview) {
  return { ...row, kind, cat, sub, needsReview: needsReview || !isComplete({ kind, cat, sub }), edited: false };
}

/**
 * A card payment shows up twice: leaving checking and arriving on the card. Matching equal
 * amounts within a week catches payments whose wording the patterns don't know.
 */
export function pairTransfers(rows, windowDays = 7) {
  const day = d => Date.parse(`${d}T00:00:00Z`) / 86400000;
  const used = new Set();
  const incoming = rows.filter(r => r.accountType === 'card' && r.cents < 0 && /PMT|PYMT|PAYMENT/i.test(r.desc));
  for (const inn of incoming) {
    const out = rows.find(r => !used.has(r) && r.accountType === 'checking' && r.account !== inn.account
      && r.cents === -inn.cents && Math.abs(day(r.date) - day(inn.date)) <= windowDays);
    if (!out) continue;
    used.add(out);
    for (const r of [out, inn]) {
      if (r.edited) continue;
      Object.assign(r, { kind: 'transfer', cat: '', sub: '', needsReview: false });
    }
  }
  return rows;
}

export function classifyAll(rows, rules, categories) {
  return pairTransfers(rows.map(r => classify(r, rules, categories)));
}
