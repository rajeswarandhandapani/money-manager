// Money and date formatting helpers shared by Money Manager components.

const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const fmt = (cents: number): string => moneyFmt.format(cents / 100);

export const fmtShort = (cents: number): string => {
  const sign = cents < 0 ? '-' : '';
  const size = Math.abs(cents);
  return size >= 100000
    ? `${sign}$${(size / 100000).toFixed(1).replace(/\.0$/, '')}k`
    : `${sign}$${Math.round(size / 100)}`;
};

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const prettyDate = (iso: string): string =>
  `${SHORT_MONTHS[+iso.slice(5, 7) - 1] ?? ''} ${+iso.slice(8)}, ${iso.slice(0, 4)}`;

export const titleCase = (text: string): string =>
  text.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

export const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
