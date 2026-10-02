"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buildSnapshot, type RawAvailabilityRow, type RawBoss, type RawConfirmationRow, type RawMonthlyBlockRow, type RawNextConfirmationRow, type RawParty } from "@/lib/scheduling/snapshot";
import { formatMeso, mesoPerPerson } from "@/lib/scheduling/meso";
import AvailabilityGrid from "@/components/AvailabilityGrid";
import BossList from "@/components/BossList";
import ImportBossesFromNexon from "@/components/ImportBossesFromNexon";

export interface Member {
  id: string;
  name: string;
  color: string | null;
}

interface Props {
  projectId: string;
  maxPerHour: number;
  currentUserId: string;
  members: Member[];
  bosses: RawBoss[];
  parties: RawParty[];
  availability: RawAvailabilityRow[];
  nextAvailability: RawAvailabilityRow[];
  monthlyBlock: RawMonthlyBlockRow[];
  confirmations: RawConfirmationRow[];
  nextConfirmations: RawNextConfirmationRow[];
  myCharacterName: string | null;
  candidates: { id: string; bossId: string; userId: string; characterName: string; memberName: string }[];
}

// 원본 아티팩트의 weekMode("this"|"next") 토글 + 가능시간 그리드 + 보스
// 목록을 한 화면에서 묶는 컨테이너. 서버 컴포넌트(page.tsx)가 떠온 스냅샷을
// 그대로 받아 클라이언트에서 후보 슬롯 계산(순수 함수, scheduling/parties.ts)만
// 다시 하고, 모든 쓰기는 Supabase에 바로 반영한 뒤 router.refresh()로 서버
// 스냅샷을 다시 받아온다 (원본의 "다 고른 다음 변경사항 저장" 발행 방식과
// 달리, 매 조작이 즉시 저장되는 구조).
export default function ScheduleBoard(props: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [weekMode, setWeekMode] = useState<"this" | "next">("this");

  const bossPeriodMap = useMemo(() => {
    const m: Record<string, "weekly" | "monthly"> = {};
    for (const b of props.bosses) m[b.id] = b.period;
    return m;
  }, [props.bosses]);

  const { snapshot } = useMemo(
    () =>
      buildSnapshot({
        bosses: props.bosses,
        parties: props.parties,
        availability: props.availability,
        nextAvailability: props.nextAvailability,
        monthlyBlock: props.monthlyBlock,
        confirmations: props.confirmations,
        nextConfirmations: props.nextConfirmations,
        maxPerHour: props.maxPerHour,
      }),
    [props]
  );

  const memberName = useMemo(() => {
    const m = new Map(props.members.map((x) => [x.id, x.name]));
    return (uid: string) => m.get(uid) ?? "?";
  }, [props.members]);

  // 넥슨 import 화면에서 "이미 있음" 표시는 "이 보스/난이도가 그룹 명단에
  // 있다"가 아니라 "이 캐릭터가 이미 후보로 등록돼 있다"는 뜻이어야 한다 --
  // 그래서 boss_candidates를 (보스이름, 난이도, 캐릭터이름) 키로 바꿔 넘긴다.
  const existingCandidates = useMemo(() => {
    const bossById = new Map(props.bosses.map((b) => [b.id, b]));
    return props.candidates.flatMap((c) => {
      const boss = bossById.get(c.bossId);
      if (!boss) return [];
      return [{ name: boss.name, difficulty: boss.difficulty, characterName: c.characterName }];
    });
  }, [props.candidates, props.bosses]);

  // 원본 #my-meso-summary 포팅: 내가 속한 파티 중 메소 테이블에 값이 있는
  // 것만 주간/월간으로 나눠 "잔여 / 총"을 합산한다.
  const mesoSummary = useMemo(() => {
    const bossById = new Map(props.bosses.map((b) => [b.id, b]));
    const byPeriod: Record<"weekly" | "monthly", { total: number; remaining: number; count: number }> = {
      weekly: { total: 0, remaining: 0, count: 0 },
      monthly: { total: 0, remaining: 0, count: 0 },
    };
    for (const p of props.parties) {
      if (!p.members.some((m) => m.userId === props.currentUserId)) continue;
      const boss = bossById.get(p.boss_id);
      if (!boss) continue;
      const perPerson = mesoPerPerson(boss.name, boss.difficulty, p.members.length);
      if (perPerson == null) continue;
      const bucket = byPeriod[boss.period];
      bucket.total += perPerson;
      bucket.count += 1;
      const cleared = snapshot.confirmed[p.id]?.cleared ?? false;
      if (!cleared) bucket.remaining += perPerson;
    }
    return byPeriod;
  }, [props.parties, props.bosses, props.currentUserId, snapshot]);

  async function refresh() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 보스 후보 등록은 그룹장 전용이 아니라 멤버 누구나 자기 캐릭터
          몫을 올릴 수 있다 -- 실제 파티 배치(드래그 앤 드롭)만 설정 화면에서
          그룹장이 한다. */}
      <ImportBossesFromNexon
        projectId={props.projectId}
        existingCandidates={existingCandidates}
        myCharacterName={props.myCharacterName}
        currentUserId={props.currentUserId}
      />

      <div className="card flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">내 가능 시간</h2>
          <div className="flex gap-1 text-xs">
            <button
              onClick={() => setWeekMode("this")}
              className={weekMode === "this" ? "btn-primary !px-3 !py-1" : "btn-secondary !px-3 !py-1"}
            >
              이번주
            </button>
            <button
              onClick={() => setWeekMode("next")}
              className={weekMode === "next" ? "btn-primary !px-3 !py-1" : "btn-secondary !px-3 !py-1"}
            >
              다음주 미리입력
            </button>
          </div>
        </div>
        <AvailabilityGrid
          projectId={props.projectId}
          userId={props.currentUserId}
          weekMode={weekMode}
          initialSlots={(weekMode === "this" ? props.availability : props.nextAvailability).filter(
            (r) => r.user_id === props.currentUserId
          )}
          onSaved={refresh}
        />
        {(mesoSummary.weekly.count > 0 || mesoSummary.monthly.count > 0) && (
          <div id="my-meso-summary" className="flex flex-col gap-0.5">
            {mesoSummary.weekly.count > 0 && (
              <p className="meso-summary">
                주간 메소: 잔여 {formatMeso(mesoSummary.weekly.remaining)} / 총 {formatMeso(mesoSummary.weekly.total)}
              </p>
            )}
            {mesoSummary.monthly.count > 0 && (
              <p className="meso-summary">
                월간 메소: 잔여 {formatMeso(mesoSummary.monthly.remaining)} / 총 {formatMeso(mesoSummary.monthly.total)}
              </p>
            )}
          </div>
        )}
      </div>

      <BossList
        projectId={props.projectId}
        maxPerHour={props.maxPerHour}
        currentUserId={props.currentUserId}
        weekMode={weekMode}
        bosses={props.bosses}
        parties={props.parties}
        snapshot={snapshot}
        memberName={memberName}
        onChanged={refresh}
      />
    </div>
  );
}
