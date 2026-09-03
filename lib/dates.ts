import { TIMEZONE } from "./types";

export function chicagoNow(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return new Date(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayISO(now = new Date()): string {
  return toISODate(chicagoNow(now));
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function startOfMonth(iso: string): string {
  const date = parseISODate(iso);
  date.setDate(1);
  return toISODate(date);
}

export function endOfMonth(iso: string): string {
  const date = parseISODate(iso);
  date.setMonth(date.getMonth() + 1, 0);
  return toISODate(date);
}

export function daysInMonth(iso: string): number {
  return parseISODate(endOfMonth(iso)).getDate();
}

export function dayOfMonth(iso: string): number {
  return parseISODate(iso).getDate();
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function inMonth(iso: string, key: string): boolean {
  return monthKey(iso) === key;
}

export function weekdayShort(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(parseISODate(iso));
}

export function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(parseISODate(iso));
}

export function formatMonthLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(parseISODate(startOfMonth(iso)));
}

export function daysBetween(fromISO: string, toISO: string): number {
  const from = parseISODate(fromISO).getTime();
  const to = parseISODate(toISO).getTime();
  return Math.round((to - from) / 86_400_000);
}

export function compareISO(a: string, b: string): number {
  return a.localeCompare(b);
}

export function clampDateToMonth(iso: string, monthISO: string): string {
  const start = startOfMonth(monthISO);
  const end = endOfMonth(monthISO);
  if (iso < start) return start;
  if (iso > end) return end;
  return iso;
}

export function mostRecentFriday(today: string): string {
  const date = parseISODate(today);
  const offset = (date.getDay() + 2) % 7; // Friday=5 → 0 when today is Friday? 
  // getDay: Sun=0 ... Fri=5 Sat=6
  const back = (date.getDay() + 7 - 5) % 7;
  date.setDate(date.getDate() - back);
  return toISODate(date);
}

export function biweeklyPaydaysAround(anchorISO: string, fromISO: string, toISO: string): string[] {
  const dates: string[] = [];
  let cursor = anchorISO;
  while (cursor > fromISO) {
    cursor = addDays(cursor, -14);
  }
  while (cursor < fromISO) {
    cursor = addDays(cursor, 14);
  }
  while (cursor <= toISO) {
    dates.push(cursor);
    cursor = addDays(cursor, 14);
  }
  return dates;
}

export function lastPaydayOnOrBefore(anchorISO: string, todayISODate: string): string {
  let cursor = anchorISO;
  if (cursor === todayISODate) return cursor;
  if (cursor < todayISODate) {
    while (addDays(cursor, 14) <= todayISODate) {
      cursor = addDays(cursor, 14);
    }
    return cursor;
  }
  while (cursor > todayISODate) {
    cursor = addDays(cursor, -14);
  }
  return cursor;
}

export function nextPaydayAfter(anchorISO: string, todayISODate: string): string {
  const last = lastPaydayOnOrBefore(anchorISO, todayISODate);
  if (last === todayISODate) return addDays(last, 14);
  return addDays(last, 14);
}
