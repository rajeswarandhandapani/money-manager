// DST-safe noon-anchored ISO date helpers (YYYY-MM-DD) and Intl formatters. Zero DOM dependencies.

const pad = (n: number): string => String(n).padStart(2, '0');

export const toIso = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Anchors at local noon so daylight-saving shifts never skip or repeat a day. */
export const fromIso = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

export const localToday = (): string => toIso(new Date());

export const addDays = (iso: string, n: number): string => {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
};

export const weekdayOf = (iso: string): number => fromIso(iso).getDay();

export const mondayOf = (iso: string): string => addDays(iso, -((weekdayOf(iso) + 6) % 7));

export const nextMonday = (iso: string): string =>
  weekdayOf(iso) === 1 ? iso : addDays(mondayOf(iso), 7);

export const daysBetween = (a: string, b: string): number =>
  Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86400000);

export const weekDates = (startIso: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(startIso, i));

export interface DateFormatters {
  longDate: (iso: string) => string;
  shortDate: (iso: string) => string;
  dayLetter: (iso: string) => string;
  dayName: (iso: string) => string;
}

export function createDateFormatters(locale = 'en-US'): DateFormatters {
  const fmt = (opts: Intl.DateTimeFormatOptions): ((iso: string) => string) => {
    const f = new Intl.DateTimeFormat(locale, opts);
    return (iso: string) => f.format(fromIso(iso));
  };
  return {
    longDate: fmt({ weekday: 'long', month: 'long', day: 'numeric' }),
    shortDate: fmt({ month: 'short', day: 'numeric' }),
    dayLetter: fmt({ weekday: 'narrow' }),
    dayName: fmt({ weekday: 'short', month: 'short', day: 'numeric' }),
  };
}

const defaults = createDateFormatters('en-US');
export const { longDate, shortDate, dayLetter, dayName } = defaults;
