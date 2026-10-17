// [추가] 캐릭터별 메소 · 솔로 보스 계산 (레이드 시간표의 charWeek / soloBossList / myChars 포팅).
// DB 행(파티, 솔로 계획, 추가 캐릭터)을 받아 계산만 하는 순수 함수 모음이다.
// 화면은 components/CharacterMesoCard.tsx, 저장 테이블은 0011 마이그레이션 참고.
import { BOSS_CATALOG, DIFFICULTIES, MESO_TABLE, mesoPerPerson } from "./meso";
import { startOfThisWeek, todayDateStr, ymdKey } from "./dates";
import type { Difficulty } from "./types";
import type { RawBoss, RawParty } from "./snapshot";

/** 캐릭터 하나가 한 주에 돌 수 있는 주간 보스 수 (같은 보스는 난이도와 상관없이 1개). */
export const WEEKLY_CAP = 12;
/** 12개를 넘칠 때 먼저 빼는 보스 순서 (그다음은 싼 것부터). */
export const SOLO_DROP_ORDER = ["듄켈", "데미안", "루시드"];
/** [추가] 보스별 파티 최대 인원. 여기 없는 보스는 DEFAULT_PARTY_MAX(6인).
 * 파티 추가·수정 폼(BossRosterEditor)의 인원 상한과 메소 카드의 공팟 인원수 선택이 같은 값을 쓴다. */
export const PARTY_MAX: Record<string, number> = {
  대적자: 3,
  벨로나: 3,
  흉성: 3,
  림보: 3,
  발드릭스: 3,
  스우: 2,
};
export const DEFAULT_PARTY_MAX = 6;
export function partyMaxOf(boss: string): number {
  return PARTY_MAX[boss] ?? DEFAULT_PARTY_MAX;
}

/** 메소 카드에서 공팟 인원수를 고를 수 있는 보스 (나머지는 솔로만). 최대 인원은 partyMaxOf를 따른다. */
const GONGPAT_BOSSES = ["칼로스", "세렌", "대적자", "벨로나", "스우", "흉성", "림보", "발드릭스"];
export const SOLO_MAX: Record<string, number> = Object.fromEntries(
  GONGPAT_BOSSES.map((b) => [b, partyMaxOf(b)])
);

export type Week = "this" | "next";

export interface SoloPlanRow {
  user_id: string;
  character_name: string;
  boss_name: string;
  difficulty: Difficulty;
  party_size: number;
  week: Week;
}
export interface SoloClearRow {
  user_id: string;
  character_name: string;
  boss_name: string;
  period_key: string;
}
export interface ExtraCharRow {
  user_id: string;
  character_name: string;
}

export function isMonthlyBossName(name: string): boolean {
  return BOSS_CATALOG.find((b) => b.name === name)?.period === "monthly";
}

/** 공팟 인원수를 그 보스가 허용하는 범위(1 ~ 최대)로 맞춘다. */
export function clampSize(boss: string, size: number | null | undefined): number {
  const max = SOLO_MAX[boss] ?? 1;
  return Math.max(1, Math.min(max, size ?? 1));
}

export interface SoloBoss {
  name: string;
  diffs: Difficulty[];
  top: number;
  monthly: boolean;
}

/** 솔로로 고를 수 있는 보스 목록: 메소표에 있는 보스를 BOSS_CATALOG 순서로. */
export function soloBossList(): SoloBoss[] {
  const order = (n: string) => {
    const i = BOSS_CATALOG.findIndex((b) => b.name === n);
    return i === -1 ? 9999 : i;
  };
  return Object.keys(MESO_TABLE)
    .map((name) => {
      const row = MESO_TABLE[name];
      const diffs = DIFFICULTIES.filter((d) => typeof row[d] === "number");
      const top = Math.max(...diffs.map((d) => row[d] as number));
      return { name, diffs, top, monthly: isMonthlyBossName(name) };
    })
    .filter((b) => b.diffs.length > 0)
    .sort((a, b) => order(a.name) - order(b.name) || b.top - a.top);
}

/** 보고 있는 주의 솔로 계획 행. 다음주는 그 캐릭터의 다음주 행이 하나라도 있으면 그것, 없으면 이번주 계획을 그대로 쓴다. */
export function planRowsFor(rows: SoloPlanRow[], uid: string, ch: string, week: Week): SoloPlanRow[] {
  const mine = rows.filter((r) => r.user_id === uid && r.character_name === ch);
  if (week === "next") {
    const next = mine.filter((r) => r.week === "next");
    if (next.length) return next;
  }
  return mine.filter((r) => r.week === "this");
}

export function hasNextPlan(rows: SoloPlanRow[], uid: string, ch: string): boolean {
  return rows.some((r) => r.user_id === uid && r.character_name === ch && r.week === "next");
}

export interface PartyEntry {
  partyId: string;
  difficulty: Difficulty | null;
  meso: number | null;
}
export interface SoloItem {
  name: string;
  diff: Difficulty;
  size: number;
  meso: number;
  monthly: boolean;
}
export interface CharWeek {
  party: Record<string, PartyEntry>; // 주간 파티 보스 (보스 이름 -> 정보)
  mparty: Record<string, PartyEntry>; // 월간 파티 보스
  partyNames: string[];
  partyMeso: number;
  monthlyPartyMeso: number;
  ok: SoloItem[]; // 실제로 계산에 들어가는 주간 솔로
  monthlyOk: SoloItem[];
  bad: { it: SoloItem; why: "party" | "cap" }[]; // 체크했지만 빠지는 것
  excluded: Set<string>;
  soloMeso: number;
  soloMonthly: number;
  count: number; // 주간 보스 개수 (파티 + 솔로)
}

/** 한 캐릭터의 한 주 메소: 파티(1인당) + 솔로. 같은 보스는 파티 우선, 12개가 넘치면 정해진 순서로 뺀다. */
export function charWeek(
  ch: string,
  uid: string,
  parties: RawParty[],
  bossById: Map<string, RawBoss>,
  planRows: SoloPlanRow[]
): CharWeek {
  const party: Record<string, PartyEntry> = {};
  const mparty: Record<string, PartyEntry> = {};
  for (const p of parties) {
    if (!p.members.some((m) => m.userId === uid && m.characterName === ch)) continue;
    const boss = bossById.get(p.boss_id);
    if (!boss) continue;
    const target = boss.period === "monthly" ? mparty : party;
    if (target[boss.name]) continue;
    target[boss.name] = {
      partyId: p.id,
      difficulty: boss.difficulty,
      meso: mesoPerPerson(boss.name, boss.difficulty, p.members.length || 1),
    };
  }
  const partyNames = Object.keys(party);
  const partyMeso = partyNames.reduce((s, n) => s + (party[n].meso ?? 0), 0);
  const monthlyPartyMeso = Object.keys(mparty).reduce((s, n) => s + (mparty[n].meso ?? 0), 0);

  const items: SoloItem[] = planRows
    .filter((r) => typeof MESO_TABLE[r.boss_name]?.[r.difficulty] === "number")
    .map((r) => {
      const size = clampSize(r.boss_name, r.party_size);
      return {
        name: r.boss_name,
        diff: r.difficulty,
        size,
        meso: (MESO_TABLE[r.boss_name][r.difficulty] as number) / size,
        monthly: isMonthlyBossName(r.boss_name),
      };
    })
    .sort((a, b) => b.meso - a.meso);

  const room = Math.max(0, WEEKLY_CAP - partyNames.length);
  const cand: SoloItem[] = [];
  const bad: CharWeek["bad"] = [];
  const monthlyOk: SoloItem[] = [];
  for (const it of items) {
    if (it.monthly) {
      if (mparty[it.name]) bad.push({ it, why: "party" });
      else monthlyOk.push(it);
    } else if (party[it.name]) bad.push({ it, why: "party" });
    else cand.push(it);
  }
  while (cand.length > room) {
    let di = -1;
    for (const name of SOLO_DROP_ORDER) {
      di = cand.findIndex((c) => c.name === name);
      if (di !== -1) break;
    }
    if (di === -1) di = cand.length - 1;
    bad.push({ it: cand.splice(di, 1)[0], why: "cap" });
  }
  const soloMeso = cand.reduce((s, it) => s + it.meso, 0);
  const soloMonthly = monthlyOk.reduce((s, it) => s + it.meso, 0);
  return {
    party,
    mparty,
    partyNames,
    partyMeso,
    monthlyPartyMeso,
    ok: cand,
    monthlyOk,
    bad,
    excluded: new Set(bad.map((b) => b.it.name)),
    soloMeso,
    soloMonthly,
    count: partyNames.length + cand.length,
  };
}

/** 내 캐릭터 목록: 내가 파티원으로 들어간 캐릭터 + 직접 추가한 캐릭터. */
// [변경] 넥슨에서 불러온 후보 캐릭터(candidates)도 내 캐릭터로 센다 (메소 카드 부캐 누락 버그 수정)
export function myCharacters(
  uid: string,
  parties: RawParty[],
  extras: ExtraCharRow[],
  candidates: { userId: string; characterName: string }[] = []
): string[] {
  const set = new Set<string>();
  for (const c of candidates) if (c.userId === uid && c.characterName) set.add(c.characterName);
  for (const p of parties) for (const m of p.members) if (m.userId === uid && m.characterName) set.add(m.characterName);
  for (const e of extras) if (e.user_id === uid) set.add(e.character_name);
  return [...set];
}

/** 솔로 클리어가 유효한 기간 키: 주간은 그 주 목요일("w2026-10-15"), 월간은 그 달("m2026-10"). */
export function soloPeriodKey(monthly: boolean, ref: Date = new Date()): string {
  if (monthly) return "m" + todayDateStr().slice(0, 7);
  const s = startOfThisWeek(ref);
  return "w" + ymdKey(s.getFullYear(), s.getMonth(), s.getDate());
}
