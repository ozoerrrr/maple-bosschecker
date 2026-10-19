// [추가] 인게임 스케줄러 동기화 공통 함수 (브라우저에서 실행).
// 넥슨 불러오기 창의 "불러오기", 스케줄 페이지 진입 시 자동 동기화, 메소 카드의 "새로고침"이 모두 이 함수를 쓴다.
// 하는 일:
//  1) /api/nexon/boss-schedule 로 캐릭터들의 인게임 스케줄러를 조회
//  2) 조회에 성공한 캐릭터를 내 캐릭터 목록(extra_characters)에 저장
//  3) 이번주 솔로 계획을 스케줄러로 덮어씀 (파티 보스 제외, plansFromScheduler 규칙)
//  4) 인게임 이번주 완료 여부로 클리어 반영: 솔로는 덮어쓰기, 파티 보스가 완료면 그 파티를 클리어 처리
//     (미완료라고 파티 클리어를 해제하지는 않는다 -- 다른 파티원의 완료를 지우지 않기 위해)
import type { createClient } from "@/lib/supabase/client";
import { displayBossName, normalizeNexonDifficulty } from "@/lib/scheduling/meso";
import { isMonthlyBossName, plansFromScheduler, soloPeriodKey, type SoloPlanRow } from "@/lib/scheduling/solo";
import { setPartyCleared } from "@/lib/scheduling/partyClear";
import type { RawBoss, RawParty } from "@/lib/scheduling/snapshot";
import type { ConfirmationMap } from "@/lib/scheduling/types";

type Client = ReturnType<typeof createClient>;

export interface SchedulerBoss {
  name: string;
  difficulty: string;
  cycle: string;
  complete: boolean;
}
export interface SchedulerCharacterResult {
  character_name: string;
  world_name: string | null;
  bosses: SchedulerBoss[];
  error?: string;
}

export interface SyncContext {
  supabase: Client;
  projectId: string;
  userId: string;
  bosses: RawBoss[];
  parties: RawParty[];
  soloPlans: SoloPlanRow[];
  confirmed: ConfirmationMap;
}

export interface SyncResult {
  error: string | null; // 요청 자체가 실패한 경우 (키 미연동 등)
  results: SchedulerCharacterResult[]; // 캐릭터별 조회 결과 (후보 등록 화면에서 사용)
  charErrors: { characterName: string; error: string }[];
  summary: string[]; // 캐릭터별 반영 결과 한 줄 요약
}

export async function syncFromScheduler(names: string[], ctx: SyncContext): Promise<SyncResult> {
  const { supabase, projectId, userId } = ctx;
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return { error: "조회할 캐릭터가 없어요.", results: [], charErrors: [], summary: [] };

  const res = await fetch(`/api/nexon/boss-schedule?names=${encodeURIComponent(unique.join(","))}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error ?? "불러오기에 실패했어요.", results: [], charErrors: [], summary: [] };

  const results: SchedulerCharacterResult[] = data.results ?? [];
  const charErrors = results.filter((r) => r.error).map((r) => ({ characterName: r.character_name, error: r.error! }));

  // 조회에 성공한 캐릭터는 내 캐릭터 목록에 저장 (이미 있으면 무시)
  const okNames = results.filter((r) => !r.error).map((r) => r.character_name);
  if (okNames.length > 0) {
    await supabase.from("extra_characters").upsert(
      okNames.map((n) => ({ project_id: projectId, user_id: userId, character_name: n })),
      { onConflict: "project_id,user_id,character_name", ignoreDuplicates: true }
    );
  }

  const bossById = new Map(ctx.bosses.map((b) => [b.id, b]));
  const summary: string[] = [];
  for (const r of results) {
    if (r.error) continue;
    const { plans, partySkipped, noMeso } = plansFromScheduler(
      userId,
      r.character_name,
      r.bosses.map((b) => ({ name: b.name, difficulty: normalizeNexonDifficulty(b.difficulty), complete: b.complete })),
      ctx.parties,
      bossById,
      ctx.soloPlans
    );
    // 이번주 솔로 계획 덮어쓰기 (다음주 계획은 그대로)
    await supabase
      .from("solo_plans")
      .delete()
      .match({ project_id: projectId, user_id: userId, character_name: r.character_name, week: "this" });
    if (plans.length > 0) {
      await supabase.from("solo_plans").insert(
        plans.map((pl) => ({
          project_id: projectId,
          user_id: userId,
          character_name: r.character_name,
          week: "this" as const,
          boss_name: pl.boss_name,
          difficulty: pl.difficulty,
          party_size: pl.party_size,
        }))
      );
    }
    // 인게임 완료 여부가 우선
    let clearedCount = 0;
    for (const pl of plans) {
      const key = {
        project_id: projectId,
        user_id: userId,
        character_name: r.character_name,
        boss_name: pl.boss_name,
        period_key: soloPeriodKey(isMonthlyBossName(pl.boss_name)),
      };
      if (pl.complete) {
        await supabase.from("solo_clears").upsert(key);
        clearedCount++;
      } else {
        await supabase.from("solo_clears").delete().match(key);
      }
    }
    for (const ps of partySkipped) {
      if (!ps.complete) continue;
      await setPartyCleared(supabase, ps.partyId, ctx.confirmed[ps.partyId], true, userId);
      clearedCount++;
    }
    summary.push(
      `${r.character_name}: 솔로 ${plans.length}개` +
        (partySkipped.length ? ` (파티 ${partySkipped.length}개 제외)` : "") +
        ` · 클리어 ${clearedCount}개` +
        (noMeso.length ? ` · 메소표에 없어 제외: ${noMeso.map((n) => displayBossName(n.name)).join(", ")}` : "")
    );
  }
  return { error: null, results, charErrors, summary };
}

// [추가] 자동 동기화 간격: 마지막 동기화 후 10분 안에 다시 들어오면 건너뛴다 (넥슨 API 호출 한도 보호).
// 이 브라우저에만 기억한다 (localStorage). 저장소를 못 쓰면 매번 동기화한다.
export const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const syncKey = (projectId: string, userId: string) => `nexon-sync:${projectId}:${userId}`;

export function shouldAutoSync(projectId: string, userId: string): boolean {
  try {
    const last = Number(localStorage.getItem(syncKey(projectId, userId)) ?? 0);
    return Date.now() - last >= AUTO_SYNC_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function markSynced(projectId: string, userId: string) {
  try {
    localStorage.setItem(syncKey(projectId, userId), String(Date.now()));
  } catch {
    // 저장소를 못 쓰는 환경이면 무시
  }
}
