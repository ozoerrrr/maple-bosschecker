// 원본 build_raid.py의 날짜 계산 헬퍼 포팅: "목요일 시작" 주 단위,
// 월간보스용 이번달/다음달 계산.
import { JS_DAY_TO_LABEL, type Day } from "./constants";

export function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

export function ymdKey(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

export function parseDateKey(dateStr: string): { year: number; month0: number; day: number } {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  return { year: y, month0: m - 1, day: d };
}

export function weekdayLabelForDate(year: number, month0: number, day: number): Day {
  return JS_DAY_TO_LABEL[new Date(year, month0, day).getDay()];
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

export function nextMonthOf(year: number, month0: number): { year: number; month0: number } {
  return month0 === 11 ? { year: year + 1, month0: 0 } : { year, month0: month0 + 1 };
}

export function currentYM(): { year: number; month0: number } {
  const now = new Date();
  return { year: now.getFullYear(), month0: now.getMonth() };
}

export function todayDateStr(): string {
  const now = new Date();
  return ymdKey(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 이번주(목~수) 시작일(목요일)의 Date. */
export function startOfThisWeek(ref: Date = new Date()): Date {
  const jsDay = ref.getDay(); // 0=일..6=토
  // 목요일(4) 기준 몇 칸 전인지
  const diffFromThursday = (jsDay - 4 + 7) % 7;
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  d.setDate(d.getDate() - diffFromThursday);
  return d;
}

export function thisWeekStartStr(ref: Date = new Date()): string {
  const d = startOfThisWeek(ref);
  return ymdKey(d.getFullYear(), d.getMonth(), d.getDate());
}

export function nextWeekStartStr(ref: Date = new Date()): string {
  const d = startOfThisWeek(ref);
  d.setDate(d.getDate() + 7);
  return ymdKey(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 이번주(목~수) 7일의 Date[] (목,금,토,일,월,화,수 순서). */
export function thisWeekDates(ref: Date = new Date()): Date[] {
  const start = startOfThisWeek(ref);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export function nextWeekDates(ref: Date = new Date()): Date[] {
  return thisWeekDates(ref).map((d) => {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + 7);
    return nd;
  });
}

const DAY_ORDER: Day[] = ["목", "금", "토", "일", "월", "화", "수"];

export function weekdayDateThisWeek(day: Day, ref: Date = new Date()): string {
  const wk = thisWeekDates(ref);
  const d = wk[DAY_ORDER.indexOf(day)];
  return ymdKey(d.getFullYear(), d.getMonth(), d.getDate());
}

export function weekdayDateNextWeek(day: Day, ref: Date = new Date()): string {
  const wk = nextWeekDates(ref);
  const d = wk[DAY_ORDER.indexOf(day)];
  return ymdKey(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isDayPastThisWeek(day: Day, ref: Date = new Date()): boolean {
  return weekdayDateThisWeek(day, ref) < todayDateStr();
}
