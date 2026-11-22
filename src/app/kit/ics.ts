// Generic recurring iCalendar (.ics) exporter and reminder schedule evaluator.

import { addDays, weekdayOf } from './dates';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface ReminderConfig {
  enabled: boolean;
  time: string;
  days: number[];
}

export interface ReminderDueInput {
  reminder?: Partial<ReminderConfig> | null;
  date: string;
  nowTime: string;
  isDone?: boolean;
  lastSent?: string | null;
}

export interface CalendarEventInfo {
  title: string;
  body?: string;
}

export interface MakeCalendarOptions {
  prodId?: string;
  uidPrefix?: string;
  startDate?: string | null;
  today: string;
  time?: string;
  durationMin?: number;
  days?: number[];
  weeks?: number;
  eventFor?: (firstIso: string) => CalendarEventInfo;
}

export function reminderDue({
  reminder,
  date,
  nowTime,
  isDone = false,
  lastSent = null,
}: ReminderDueInput): boolean {
  if (!reminder?.enabled || lastSent === date || isDone) return false;
  const days = Array.isArray(reminder.days) ? reminder.days : [1, 2, 3, 4, 5, 6, 0];
  if (!days.includes(weekdayOf(date))) return false;
  if (!TIME.test(reminder.time ?? '') || !TIME.test(nowTime ?? '') || nowTime < (reminder.time ?? '')) {
    return false;
  }
  return true;
}

export function makeCalendar({
  prodId = '-//Angular PWA Kit//EN',
  uidPrefix = 'pwa-reminder',
  startDate,
  today,
  time = '19:00',
  durationMin = 25,
  days = [1, 2, 3, 4, 5, 6, 0],
  weeks = 12,
  eventFor = () => ({ title: 'Daily practice', body: 'Open the app to log today.' }),
}: MakeCalendarOptions): string {
  const base = ISO.test(startDate ?? '') ? (startDate as string) : today;
  const validTime = TIME.test(time ?? '') ? time : '19:00';
  const [hh, mm] = validTime.split(':');
  const baseWeekday = weekdayOf(base);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
  ];
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) continue;
    const offset = (d - baseWeekday + 7) % 7;
    const firstIso = addDays(base, offset);
    const firstDate = firstIso.replaceAll('-', '');
    const info = eventFor(firstIso) || { title: 'Daily practice', body: '' };
    const title = info.title || 'Daily practice';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uidPrefix}-${d}@local`,
      `DTSTART:${firstDate}T${hh}${mm}00`,
      `DURATION:PT${Math.max(5, Math.round(durationMin))}M`,
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[d]};COUNT=${Math.max(1, Math.round(weeks))}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${info.body || ''}`,
      'BEGIN:VALARM',
      'TRIGGER:PT0M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${title}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
