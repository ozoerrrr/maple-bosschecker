// Supabase에서 읽어온 날 raw row들을 parties.ts가 기대하는 ScheduleSnapshot
// 모양으로 조립하는 헬퍼. 서버 컴포넌트와 클라이언트 컴포넌트 양쪽에서 다
// 쓸 수 있도록 입력은 전부 평범한 배열/객체(직렬화 가능)로 받는다.
import { DEFAULT_MAX_PER_HOUR } from "./constants";
import type { AvailabilityMap, ConfirmationMap, Difficulty, MonthlyBlockMap, NextConfirmationMap, Party } from "./types";
import type { ScheduleSnapshot } from "./parties";

export interface RawBoss {
  id: string;
  name: string;
  period: "weekly" | "monthly";
  difficulty: Difficulty | null;
  sort_order: number;
  next_custom?: boolean; // [추가] 0017: 다음주 파티를 이번주와 따로 짰는지
}

/** party_members 조인 결과 한 행: 누구(user_id)이고, 어떤 캐릭터로 도는지. */
export interface RawPartyMember {
  userId: string;
  characterName: string | null;
}

export interface RawParty {
  id: string;
  boss_id: string;
  label: string | null;
  sort_order: number;
  week?: "this" | "next"; // [추가] 0017: 없으면 이번주 파티
  members: RawPartyMember[];
}

/**
 * [추가] 0017: 파티를 "이번주 파티"와 "다음주에 보일 파티"로 나눈다.
 * 다음주 따로(next_custom)인 보스는 다음주 전용 파티(week='next'), 아니면 이번주 파티를 그대로 다음주로 쓴다.
 * 월간 보스는 다음주 따로가 될 수 없어서 항상 이번주 파티가 양쪽에 들어간다.
 */
export function splitRosters<P extends { boss_id: string; week?: string | null }>(
  bosses: { id: string; next_custom?: boolean | null }[],
  parties: P[]
): { thisParties: P[]; nextParties: P[] } {
  const custom = new Set(bosses.filter((b) => b.next_custom).map((b) => b.id));
  const isThis = (p: P) => (p.week ?? "this") === "this";
  return {
    thisParties: parties.filter(isThis),
    nextParties: parties.filter((p) => (custom.has(p.boss_id) ? p.week === "next" : isThis(p))),
  };
}

export interface RawAvailabilityRow {
  user_id: string;
  day: string;
  hour: number;
}

export interface RawMonthlyBlockRow {
  user_id: string;
  blocked_date: string;
}

export interface RawConfirmationRow {
  party_id: string;
  day: string | null;
  hour: number | null;
  confirmed_date: string | null;
  cleared: boolean;
}

export interface RawNextConfirmationRow {
  party_id: string;
  day: string | null;
  hour: number | null;
}

function groupAvailability(rows: RawAvailabilityRow[]): AvailabilityMap {
  const map: AvailabilityMap = {};
  for (const r of rows) {
    if (!map[r.user_id]) map[r.user_id] = [];
    map[r.user_id].push({ day: r.day as any, hour: r.hour });
  }
  return map;
}

function groupMonthlyBlock(rows: RawMonthlyBlockRow[]): MonthlyBlockMap {
  const map: MonthlyBlockMap = {};
  for (const r of rows) {
    if (!map[r.user_id]) map[r.user_id] = [];
    map[r.user_id].push(r.blocked_date);
  }
  return map;
}

export function buildSnapshot(input: {
  bosses: RawBoss[];
  parties: RawParty[];
  nextParties?: RawParty[]; // [추가] 0017: 다음주 파티 (없으면 이번주 파티와 같음)
  availability: RawAvailabilityRow[];
  nextAvailability: RawAvailabilityRow[];
  monthlyBlock: RawMonthlyBlockRow[];
  confirmations: RawConfirmationRow[];
  nextConfirmations: RawNextConfirmationRow[];
  maxPerHour?: number;
}): { snapshot: ScheduleSnapshot; parties: Party[] } {
  const bossPeriod: Record<string, "weekly" | "monthly"> = {};
  for (const b of input.bosses) bossPeriod[b.id] = b.period;

  // scheduling/parties.ts의 후보 슬롯 계산은 순수하게 user_id 집합만
  // 필요하므로(누가 어떤 캐릭터인지는 무관), 여기서는 캐릭터명을 뺀
  // user_id 배열로 납작하게 펴서 넘긴다.
  const toParty = (p: RawParty): Party => ({
    id: p.id,
    project_id: "",
    boss_id: p.boss_id,
    label: p.label,
    sort_order: p.sort_order,
    members: p.members.map((m) => m.userId),
  });
  const parties: Party[] = input.parties.map(toParty);
  const nextParties: Party[] = input.nextParties ? input.nextParties.map(toParty) : parties; // [추가] 0017

  const confirmed: ConfirmationMap = {};
  for (const c of input.confirmations) {
    confirmed[c.party_id] = {
      party_id: c.party_id,
      day: c.day as any,
      hour: c.hour,
      confirmed_date: c.confirmed_date,
      cleared: c.cleared,
    };
  }

  const nextConfirmed: NextConfirmationMap = {};
  for (const c of input.nextConfirmations) {
    nextConfirmed[c.party_id] = { party_id: c.party_id, day: c.day as any, hour: c.hour };
  }

  const snapshot: ScheduleSnapshot = {
    parties,
    nextParties, // [추가] 0017
    bossPeriod,
    avail: groupAvailability(input.availability),
    nextAvail: groupAvailability(input.nextAvailability),
    monthlyBlock: groupMonthlyBlock(input.monthlyBlock),
    confirmed,
    nextConfirmed,
    maxPerHour: input.maxPerHour ?? DEFAULT_MAX_PER_HOUR,
  };

  return { snapshot, parties };
}
