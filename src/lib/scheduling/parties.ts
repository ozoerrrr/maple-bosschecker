// 원본 build_raid.py의 lockCount/capOk/candidateSlots/reconcileConfirmed 등을
// 포팅. DB 행 집합(parties, availability, confirmations)을 입력으로 받아
// "순수 함수"로 계산한다 -- 원본처럼 STATE를 직접 들고 있지 않고, 호출하는
// 쪽(서버 컴포넌트 / route handler)이 Supabase에서 읽어온 스냅샷을 넘긴다.
import { DAYS, HOURS, type Day } from "./constants";
import { isAvailable, isAvailableIgnoringBlock, isAvailableNext } from "./availability";
import { daysInMonth, isDayPastThisWeek, nextMonthOf, parseDateKey, weekdayLabelForDate, ymdKey } from "./dates";
import { isMonthlyBlockedRaw } from "./dates-block";
import type {
  AvailabilityMap,
  ConfirmationMap,
  MonthlyBlockMap,
  NextConfirmationMap,
  Party,
  Slot,
} from "./types";

export interface ScheduleSnapshot {
  parties: Party[]; // 월간/주간 섞여 있음 (party.boss로 period 조회)
  bossPeriod: Record<string, "weekly" | "monthly">; // boss_id -> period
  avail: AvailabilityMap;
  nextAvail: AvailabilityMap;
  monthlyBlock: MonthlyBlockMap;
  confirmed: ConfirmationMap;
  nextConfirmed: NextConfirmationMap;
  maxPerHour: number;
}

function periodOf(snap: ScheduleSnapshot, p: Party): "weekly" | "monthly" {
  return snap.bossPeriod[p.boss_id] ?? "weekly";
}

/** 원본 lockCount: 이 사람이 이 (day,hour)에 이미 확정 잠겨있는 (완료 제외)
 * 파티가 몇 개인지. excludePartyId는 "내가 지금 확정하려는 파티 자신". */
export function lockCount(
  snap: ScheduleSnapshot,
  uid: string,
  day: Day,
  hour: number,
  excludePartyId?: string
): number {
  let n = 0;
  for (const p of snap.parties) {
    if (p.id === excludePartyId) continue;
    const c = snap.confirmed[p.id];
    if (!c || c.cleared) continue;
    if (!p.members.includes(uid)) continue;
    if (c.day !== day || c.hour !== hour) continue;
    n++;
  }
  return n;
}

export function capOk(snap: ScheduleSnapshot, p: Party, day: Day, hour: number): boolean {
  return p.members.every((u) => lockCount(snap, u, day, hour, p.id) < snap.maxPerHour);
}

/** 모든 멤버가 가용성을 등록했는지 (원본 allMembersSet). */
export function allMembersSet(snap: ScheduleSnapshot, p: Party): boolean {
  return p.members.every((uid) => {
    const arr = snap.avail[uid];
    return !!(arr && arr.length);
  });
}

/** 이 파티가 확정 가능한 (day,hour) 후보 전체 (원본 candidateSlots). */
export function candidateSlots(snap: ScheduleSnapshot, p: Party): Slot[] {
  const out: Slot[] = [];
  for (const d of DAYS) {
    if (isDayPastThisWeek(d)) continue;
    for (const h of HOURS) {
      const everyoneFree = p.members.every((uid) => isAvailable(snap.avail, snap.monthlyBlock, uid, d, h));
      if (!everyoneFree) continue;
      if (!capOk(snap, p, d, h)) continue;
      out.push({ day: d, hour: h });
    }
  }
  return out;
}

/** 확정된 슬롯이 더는 유효하지 않으면(멤버 가용성 변경, 캡 초과) 지운 새
 * ConfirmationMap을 반환 (원본 reconcileConfirmed -- 부작용 없는 순수 버전). */
export function reconcileConfirmed(snap: ScheduleSnapshot): string[] {
  const toClear: string[] = [];
  for (const p of snap.parties) {
    const slot = snap.confirmed[p.id];
    if (!slot) continue;
    if (slot.cleared) continue;
    if (periodOf(snap, p) === "monthly") {
      if (!slot.confirmed_date || slot.hour == null) continue;
      const pd = parseDateKey(slot.confirmed_date);
      const weekday = weekdayLabelForDate(pd.year, pd.month0, pd.day);
      const stillFree = p.members.every(
        (uid) =>
          !isMonthlyBlockedRaw(snap.monthlyBlock, uid, slot.confirmed_date as string) &&
          isAvailableIgnoringBlock(snap.avail, uid, weekday, slot.hour as number)
      );
      if (!stillFree) toClear.push(p.id);
      continue;
    }
    if (slot.day == null || slot.hour == null) continue;
    const everyoneFree = p.members.every((uid) => isAvailable(snap.avail, snap.monthlyBlock, uid, slot.day as Day, slot.hour as number));
    const stillOk = everyoneFree && capOk(snap, p, slot.day as Day, slot.hour as number);
    if (!stillOk) toClear.push(p.id);
  }
  return toClear;
}

export interface MonthlyDateCandidate {
  date: string; // YYYY-MM-DD
  hour: number;
}

/**
 * 월간보스 파티의 실제 달력 날짜 후보 (원본엔 없던, 이 웹앱 전용 확장).
 * 오늘부터 이번달 남은 날 + 다음달 전체를 훑으면서, 그 날짜(monthlyBlock)로
 * 막아둔 멤버가 없고 모든 멤버의 요일 반복 가용성(monthlyBlock은 무시하고
 * 요일+시간만 봄, isAvailableIgnoringBlock)이 그 요일+시간을 커버하는
 * 슬롯만 후보로 낸다.
 *
 * 알려진 단순화: 원본의 "월간보스가 같은 슬롯을 쓰는 주간파티 확정을 밀어낼
 * 수 있다"(cap-stealing) 동작은 이번 증분에서 구현하지 않는다 -- capOk/
 * lockCount 연동 없이 순수 날짜 후보만 나열한다 (월간보스는 주간파티와
 * 캡 충돌로 막히지 않는다).
 */
export function candidateMonthlyDates(
  snap: ScheduleSnapshot,
  p: Party,
  today: Date = new Date()
): MonthlyDateCandidate[] {
  const out: MonthlyDateCandidate[] = [];
  const todayStr = ymdKey(today.getFullYear(), today.getMonth(), today.getDate());

  const thisMonth = { year: today.getFullYear(), month0: today.getMonth() };
  const nextMonth = nextMonthOf(thisMonth.year, thisMonth.month0);

  for (const { year, month0 } of [thisMonth, nextMonth]) {
    const numDays = daysInMonth(year, month0);
    for (let day = 1; day <= numDays; day++) {
      const dateStr = ymdKey(year, month0, day);
      if (dateStr < todayStr) continue;
      const weekday = weekdayLabelForDate(year, month0, day);
      for (const h of HOURS) {
        const everyoneFree = p.members.every(
          (uid) =>
            !isMonthlyBlockedRaw(snap.monthlyBlock, uid, dateStr) &&
            isAvailableIgnoringBlock(snap.avail, uid, weekday, h)
        );
        if (everyoneFree) out.push({ date: dateStr, hour: h });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// "다음주 미리입력/미리확정" 전용 버전 (원본 lockCountNext/capOkNext/
// candidateSlotsNext/reconcileNextConfirmed). 월간보스는 애초에 다음주 탭에
// 노출하지 않으므로 호출하는 쪽에서 weekly 보스만 걸러서 넘긴다.
// ---------------------------------------------------------------------------
export function lockCountNext(
  snap: ScheduleSnapshot,
  uid: string,
  day: Day,
  hour: number,
  excludePartyId?: string
): number {
  let n = 0;
  for (const p of snap.parties) {
    if (p.id === excludePartyId) continue;
    if (periodOf(snap, p) === "monthly") continue;
    if (!p.members.includes(uid)) continue;
    const c = snap.nextConfirmed[p.id];
    if (!c || c.day !== day || c.hour !== hour) continue;
    n++;
  }
  return n;
}

export function capOkNext(snap: ScheduleSnapshot, p: Party, day: Day, hour: number): boolean {
  return p.members.every((u) => lockCountNext(snap, u, day, hour, p.id) < snap.maxPerHour);
}

export function candidateSlotsNext(snap: ScheduleSnapshot, p: Party): Slot[] {
  const out: Slot[] = [];
  for (const d of DAYS) {
    for (const h of HOURS) {
      const everyoneFree = p.members.every((uid) => isAvailableNext(snap.nextAvail, uid, d, h));
      if (!everyoneFree) continue;
      if (!capOkNext(snap, p, d, h)) continue;
      out.push({ day: d, hour: h });
    }
  }
  return out;
}

export function reconcileNextConfirmed(snap: ScheduleSnapshot): string[] {
  const toClear: string[] = [];
  for (const p of snap.parties) {
    if (periodOf(snap, p) === "monthly") continue;
    const slot = snap.nextConfirmed[p.id];
    if (!slot) continue;
    const everyoneFree = p.members.every((uid) => isAvailableNext(snap.nextAvail, uid, slot.day as Day, slot.hour as number));
    const stillOk = everyoneFree && capOkNext(snap, p, slot.day as Day, slot.hour as number);
    if (!stillOk) toClear.push(p.id);
  }
  return toClear;
}

/** 원본 allWeeklyCleared: 주간보스가 전부 완료 표시됐는지 (다음주 탭 자동 전환용). */
export function allWeeklyCleared(snap: ScheduleSnapshot): boolean {
  const weekly = snap.parties.filter((p) => periodOf(snap, p) !== "monthly");
  if (!weekly.length) return false;
  return weekly.every((p) => snap.confirmed[p.id]?.cleared);
}
