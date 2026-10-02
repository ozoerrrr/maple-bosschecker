// Supabase에서 읽어온 날 raw row들을 parties.ts가 기대하는 ScheduleSnapshot
// 모양으로 조립하는 헬퍼. 서버 컴포넌트와 클라이언트 컴포넌트 양쪽에서 다
// 쓸 수 있도록 입력은 전부 평범한 배열/객체(직렬화 가능)로 받는다.
import { DEFAULT_MAX_PER_HOUR } from "./constants";
import type { AvailabilityMap, ConfirmationMap, MonthlyBlockMap, NextConfirmationMap, Party } from "./types";
import type { ScheduleSnapshot } from "./parties";

export interface RawBoss {
  id: string;
  name: string;
  period: "weekly" | "monthly";
  sort_order: number;
}

export interface RawParty {
  id: string;
  boss_id: string;
  label: string | null;
  sort_order: number;
  members: string[];
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
  availability: RawAvailabilityRow[];
  nextAvailability: RawAvailabilityRow[];
  monthlyBlock: RawMonthlyBlockRow[];
  confirmations: RawConfirmationRow[];
  nextConfirmations: RawNextConfirmationRow[];
  maxPerHour?: number;
}): { snapshot: ScheduleSnapshot; parties: Party[] } {
  const bossPeriod: Record<string, "weekly" | "monthly"> = {};
  for (const b of input.bosses) bossPeriod[b.id] = b.period;

  const parties: Party[] = input.parties.map((p) => ({
    id: p.id,
    project_id: "",
    boss_id: p.boss_id,
    label: p.label,
    sort_order: p.sort_order,
    members: p.members,
  }));

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
