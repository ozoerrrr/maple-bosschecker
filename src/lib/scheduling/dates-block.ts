// availability.ts <-> dates.ts 순환 참조를 피하기 위한 작은 헬퍼 모음.
import type { MonthlyBlockMap } from "./types";
import { weekdayDateThisWeek as _thisWeek, weekdayDateNextWeek as _nextWeek } from "./dates";
import type { Day } from "./constants";

export function isMonthlyBlockedRaw(map: MonthlyBlockMap, uid: string, dateStr: string): boolean {
  const arr = map[uid];
  return !!arr && arr.indexOf(dateStr) !== -1;
}

export function weekdayDateThisWeek(day: Day): string {
  return _thisWeek(day);
}

export function weekdayDateNextWeek(day: Day): string {
  return _nextWeek(day);
}
