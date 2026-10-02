// 원본 build_raid.py의 가용성 판정 로직 포팅.
// "아직 아무것도 등록 안 한 사람은 일단 아무 때나 가능한 것으로 계산" 이라는
// 원본의 핵심 규칙(allMembersSet 가드와 짝을 이룸)을 그대로 따른다.
import { DAYS, type Day } from "./constants";
import { isMonthlyBlockedRaw, weekdayDateThisWeek, weekdayDateNextWeek } from "./dates-block";
import type { AvailabilityMap, MonthlyBlockMap } from "./types";

export function hasRegistered(avail: AvailabilityMap, uid: string): boolean {
  const arr = avail[uid];
  return !!(arr && arr.length);
}

function isSlotMarked(avail: AvailabilityMap, uid: string, day: Day, hour: number): boolean {
  const arr = avail[uid];
  if (!arr || !arr.length) return true; // 미등록자는 "아무 때나 가능"
  return arr.some((s) => s.day === day && s.hour === hour);
}

/** 이번주 가용성(요일 블록 포함: monthlyBlock에 걸린 날은 그 요일 전체 불가). */
export function isAvailable(
  avail: AvailabilityMap,
  monthlyBlock: MonthlyBlockMap,
  uid: string,
  day: Day,
  hour: number
): boolean {
  if (isMonthlyBlockedRaw(monthlyBlock, uid, weekdayDateThisWeek(day))) return false;
  return isSlotMarked(avail, uid, day, hour);
}

/** monthlyBlock을 무시하는 버전 (월간보스 재검증 전용, 원본 isAvailableIgnoringBlock). */
export function isAvailableIgnoringBlock(
  avail: AvailabilityMap,
  uid: string,
  day: Day,
  hour: number
): boolean {
  return isSlotMarked(avail, uid, day, hour);
}

/** 다음주 미리입력 탭 전용 (원본 isAvailableNext) -- monthlyBlock과 무관. */
export function isAvailableNext(
  nextAvail: AvailabilityMap,
  uid: string,
  day: Day,
  hour: number
): boolean {
  return isSlotMarked(nextAvail, uid, day, hour);
}

export function allDays(): readonly Day[] {
  return DAYS;
}
