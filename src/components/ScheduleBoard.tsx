"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  buildSnapshot,
  type RawAvailabilityRow,
  type RawBoss,
  type RawConfirmationRow,
  type RawMonthlyBlockRow,
  type RawNextConfirmationRow,
  type RawParty,
} from "@/lib/scheduling/snapshot";
import { reconcileConfirmed, reconcileNextConfirmed } from "@/lib/scheduling/parties";
import AvailabilityGrid from "@/components/AvailabilityGrid";
import MonthlyBlockCalendar from "@/components/MonthlyBlockCalendar";
import MySchedule from "@/components/MySchedule";
import CharacterMesoCard from "@/components/CharacterMesoCard";
import type { ExtraCharRow, SoloClearRow, SoloPlanRow } from "@/lib/scheduling/solo";
import BossList from "@/components/BossList";
import ImportBossesFromNexon from "@/components/ImportBossesFromNexon";
import { markSynced, shouldAutoSync, syncFromScheduler } from "@/lib/nexon/syncScheduler";
import { markLocalChange } from "@/components/LiveRefreshButton";
import DiscordLinkBanner from "@/components/DiscordLinkBanner";

export interface Member {
  id: string;
  name: string;
  color: string | null;
}

interface Props {
  projectId: string;
  maxPerHour: number;
  currentUserId: string;
  isOwner: boolean; // [추가] 그룹장 여부 (파티 일정 수정 권한 판단용)
  members: Member[];
  bosses: RawBoss[];
  parties: RawParty[];
  nextParties: RawParty[]; // [추가] 0017: 다음주에 보일 파티 (다음주 미리입력 토글)
  availability: RawAvailabilityRow[];
  nextAvailability: RawAvailabilityRow[];
  monthlyBlock: RawMonthlyBlockRow[];
  confirmations: RawConfirmationRow[];
  nextConfirmations: RawNextConfirmationRow[];
  myCharacterName: string | null;
  discordLinked: boolean; // [추가] 디스코드 연결 여부 (연결 안내 배너)
  // [추가] 캐릭터별 메소·솔로 보스 카드용 (0011)
  soloPlans: SoloPlanRow[];
  soloClears: SoloClearRow[];
  extraChars: ExtraCharRow[];
  candidates: {
    id: string;
    bossId: string;
    userId: string;
    characterName: string;
    memberName: string;
  }[];
}

export default function ScheduleBoard(props: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [weekMode, setWeekMode] = useState<"this" | "next">("this");
  const [isTimeModalOpen, setIsTimeModalOpen] = useState(false);
  const [countdown, setCountdown] = useState("D-0 00:00:00");

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const day = now.getDay();
      const diffDays = (4 - day + 7) % 7 || 7;
      const target = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + diffDays,
        0,
        0,
        0
      );
      const diffMs = target.getTime() - now.getTime();
      const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const h = String(Math.floor((diffMs / (1000 * 60 * 60)) % 24)).padStart(2, "0");
      const m = String(Math.floor((diffMs / (1000 * 60)) % 60)).padStart(2, "0");
      const s = String(Math.floor((diffMs / 1000) % 60)).padStart(2, "0");
      setCountdown(`D-${d} ${h}:${m}:${s}`);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, []);

  const { snapshot } = useMemo(
    () =>
      buildSnapshot({
        bosses: props.bosses,
        parties: props.parties,
        nextParties: props.nextParties, // [추가] 0017
        availability: props.availability,
        nextAvailability: props.nextAvailability,
        monthlyBlock: props.monthlyBlock,
        confirmations: props.confirmations,
        nextConfirmations: props.nextConfirmations,
        maxPerHour: props.maxPerHour,
      }),
    [props]
  );

  // [추가] 확정 재검증: 가능 시간·안 되는 날짜가 바뀌어 파티원 모두가 가능한 시간이 아니게 된
  // 확정을 자동으로 푼다. 내가 수정할 수 있는 파티(파티원 또는 그룹장)만 처리한다(0009와 같은 기준).
  // 한 번 시도한 파티는 다시 시도하지 않아, 삭제가 실패해도 무한 반복하지 않는다.
  const reconcileTriedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const canEdit = (pid: string) =>
      props.isOwner ||
      // [변경] 0017: 다음주 전용 파티도 파티원이면 수정 가능
      !![...snapshot.parties, ...snapshot.nextParties].find((p) => p.id === pid)?.members.includes(props.currentUserId);
    const fresh = (ids: string[]) => ids.filter((id) => canEdit(id) && !reconcileTriedRef.current.has(id));
    const stale = fresh(reconcileConfirmed(snapshot));
    const staleNext = fresh(reconcileNextConfirmed(snapshot));
    if (!stale.length && !staleNext.length) return;
    [...stale, ...staleNext].forEach((id) => reconcileTriedRef.current.add(id));
    (async () => {
      if (stale.length) await supabase.from("party_confirmations").delete().in("party_id", stale);
      if (staleNext.length) await supabase.from("next_party_confirmations").delete().in("party_id", staleNext);
      markLocalChange(); // [추가]
      router.refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  const memberName = useMemo(() => {
    const m = new Map(props.members.map((x) => [x.id, x.name]));
    return (uid: string) => m.get(uid) ?? "?";
  }, [props.members]);

  // [추가] 넥슨 불러오기 창에 처음부터 채워 둘 내 캐릭터 이름
  // (내가 후보로 등록한 캐릭터 + 직접 추가한 캐릭터). 페이지를 옮겨도 목록이 유지된다.
  const mySavedCharNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of props.candidates) if (c.userId === props.currentUserId) names.add(c.characterName);
    for (const e of props.extraChars) if (e.user_id === props.currentUserId) names.add(e.character_name);
    return [...names];
  }, [props.candidates, props.extraChars, props.currentUserId]);

  const existingCandidates = useMemo(() => {
    const bossById = new Map(props.bosses.map((b) => [b.id, b]));
    return props.candidates.flatMap((c) => {
      const boss = bossById.get(c.bossId);
      if (!boss) return [];
      return [
        {
          name: boss.name,
          difficulty: boss.difficulty,
          characterName: c.characterName,
        },
      ];
    });
  }, [props.candidates, props.bosses]);

  async function refresh() {
    markLocalChange(); // [추가] 내가 저장한 변경은 레드닷을 켜지 않게
    router.refresh();
  }

  // [추가] 넥슨 인게임 스케줄러 동기화 (솔로 계획·클리어). 스케줄 페이지 진입 시 한 번 자동(10분 간격),
  // 메소 카드의 "새로고침" 버튼으로 수동. 넥슨을 연동한 사람만 (프로필 본캐가 있을 때).
  const [nexonSyncing, setNexonSyncing] = useState(false);
  const [nexonSummary, setNexonSummary] = useState<string[]>([]);
  const nexonLinked = !!props.myCharacterName;
  async function syncNexon() {
    if (!nexonLinked || nexonSyncing) return;
    setNexonSyncing(true);
    markLocalChange(30000); // [추가] 동기화 중 내 저장으로 생기는 변경은 레드닷을 켜지 않게
    const sync = await syncFromScheduler([props.myCharacterName!, ...mySavedCharNames], {
      supabase,
      projectId: props.projectId,
      userId: props.currentUserId,
      bosses: props.bosses,
      parties: props.parties,
      soloPlans: props.soloPlans,
      confirmed: snapshot.confirmed,
    });
    setNexonSyncing(false);
    markSynced(props.projectId, props.currentUserId);
    setNexonSummary(sync.error ? [`넥슨 불러오기 실패: ${sync.error}`] : [...sync.summary, ...sync.charErrors.map((c) => `${c.characterName}: ${c.error}`)]);
    router.refresh();
  }
  const autoSyncTriedRef = useRef(false);
  useEffect(() => {
    if (autoSyncTriedRef.current || !nexonLinked) return;
    autoSyncTriedRef.current = true;
    if (shouldAutoSync(props.projectId, props.currentUserId)) void syncNexon();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 페이지 진입 시 한 번만
  }, []);

  const mySlotsCount = useMemo(() => {
    const targetAvail = weekMode === "this" ? props.availability : props.nextAvailability;
    return targetAvail.filter((r) => r.user_id === props.currentUserId).length;
  }, [props.availability, props.nextAvailability, props.currentUserId, weekMode]);

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full pb-16 font-sans">
      {/* [추가] 디스코드 미연동 안내 (본인에게만, 닫으면 다시 안 뜸) */}
      <DiscordLinkBanner linked={props.discordLinked} />

      {/* 1. 상단 안내 및 리셋 카운트다운 배너 */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-br from-orange-50/90 to-amber-50/50 border border-orange-200/80 shadow-sm">
        <div>
          <h1 className="text-lg font-extrabold text-orange-950 flex items-center gap-2">
            <span>🍁</span>
            <span>주간 보스 레이드 스케줄러</span>
          </h1>
          <p className="text-xs sm:text-sm text-orange-800/90 mt-1">
            파티원 가능 시간을 기반으로 겹치는 최적 시간대를 자동으로 계산하여 추천합니다.
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto bg-white px-4 py-2.5 rounded-xl border border-orange-200/80 shadow-sm">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <div className="text-[11px] font-semibold text-orange-900/80">
              주간 리셋 (매주 목요일 00:00)
            </div>
            <div className="text-sm font-bold text-orange-600 font-mono">
              {countdown}
            </div>
          </div>
        </div>
      </section>

      {/* 2. 내 캐릭터 후보 등록 (넥슨 연동) */}
      <ImportBossesFromNexon
        projectId={props.projectId}
        existingCandidates={existingCandidates}
        myCharacterName={props.myCharacterName}
        currentUserId={props.currentUserId}
        savedCharacterNames={mySavedCharNames} // [추가]
        bosses={props.bosses} // [추가] 후보는 그룹에 있는 보스에만
        parties={props.parties} // [추가] 메소 카드 자동 채우기: 파티 보스 우선
        soloPlans={props.soloPlans} // [추가] 기존 공팟 인원 유지
        confirmed={snapshot.confirmed} // [추가] 인게임 완료 -> 파티 클리어 반영
      />

      {/* 3. 내 상태 및 가능 시간 설정 퀵 바 (팝업 트리거)
          [추가] 스크롤해도 사이트 상단 바(약 61px) 바로 아래에 붙어서 따라온다 (sticky).
          z-30: 보스 목록 등 카드 위로, 상단 바(z-40)와 가능 시간 팝업보다는 아래로 */}
      <section className="sticky top-[61px] z-30 flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-white border border-slate-200/90 shadow-md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-800">
              👤 {memberName(props.currentUserId)} 님
            </span>
            {props.myCharacterName && (
              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                {props.myCharacterName}
              </span>
            )}
          </div>

          <div className="h-4 w-[1px] bg-slate-200 hidden sm:block" />

          {/* 주차 선택 탭 */}
          <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200/60">
            <button
              onClick={() => setWeekMode("this")}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                weekMode === "this"
                  ? "bg-white text-orange-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              이번주
            </button>
            <button
              onClick={() => setWeekMode("next")}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                weekMode === "next"
                  ? "bg-white text-orange-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              다음주 미리입력
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <span className="text-xs text-slate-500">
            등록된 가능 시간:{" "}
            <strong className="text-orange-600 font-bold">{mySlotsCount}개</strong>
          </span>
          <button
            onClick={() => setIsTimeModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md shadow-orange-500/20 hover:from-orange-600 hover:to-orange-700 transition active:scale-95"
          >
            <span>🕒</span>
            <span>내 가능 시간 설정</span>
          </button>
        </div>
      </section>

      {/* [추가] 내 스케줄: 내가 속한 파티를 시간순으로 모아 본다 */}
      <MySchedule
        currentUserId={props.currentUserId}
        bosses={props.bosses}
        parties={props.parties}
        nextParties={props.nextParties} // [추가] 0017
        weekMode={weekMode} // [추가] 다음주 미리입력 토글을 따른다
        confirmations={props.confirmations}
        nextConfirmations={props.nextConfirmations}
        memberName={memberName}
      />

      {/* 4. 보스 파티 일정 목록 */}
      <BossList
        projectId={props.projectId}
        maxPerHour={props.maxPerHour}
        currentUserId={props.currentUserId}
        isOwner={props.isOwner} // [추가] 권한 판단용으로 PartyCard까지 전달
        weekMode={weekMode}
        bosses={props.bosses}
        parties={weekMode === "next" ? props.nextParties : props.parties} // [변경] 0017: 다음주 탭은 다음주 파티
        snapshot={snapshot}
        memberName={memberName}
        onChanged={refresh}
      />

      {/* [추가] 캐릭터별 메소 · 솔로 보스 */}
      <CharacterMesoCard
        projectId={props.projectId}
        currentUserId={props.currentUserId}
        weekMode={weekMode}
        bosses={props.bosses}
        parties={weekMode === "next" ? props.nextParties : props.parties} // [변경] 0017: 다음주 탭은 다음주 파티로 잠금·메소 계산
        soloPlans={props.soloPlans}
        soloClears={props.soloClears}
        extraChars={props.extraChars}
        candidates={props.candidates} // [추가]
        confirmed={snapshot.confirmed} // [추가] 파티 보스 클리어 체크 = 파티 클리어 상태
        nexonLinked={nexonLinked} // [추가] 넥슨 연동 여부 ("새로고침" 버튼 표시)
        nexonSyncing={nexonSyncing}
        nexonSummary={nexonSummary}
        onRefreshNexon={syncNexon}
        onChanged={refresh}
      />

      {/* 5. [내 가능 시간 설정] 팝업 모달 */}
      {isTimeModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsTimeModalOpen(false);
          }}
        >
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-b from-white to-slate-50">
              <div className="flex items-center gap-2">
                <span className="text-xl">🕒</span>
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  내 가능 시간 설정 ({weekMode === "this" ? "이번주" : "다음주 미리입력"})
                </h3>
              </div>
              <button
                onClick={() => setIsTimeModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            {/* 모달 내용: AvailabilityGrid 탑재 */}
            <div className="p-6 overflow-y-auto">
              <AvailabilityGrid
                projectId={props.projectId}
                userId={props.currentUserId}
                weekMode={weekMode}
                initialSlots={(weekMode === "this"
                  ? props.availability
                  : props.nextAvailability
                ).filter((r) => r.user_id === props.currentUserId)}
                onSaved={refresh}
              />
              {/* [추가] 안 되는 날짜(월간 불가 날짜) 입력 달력: 날짜 기준이라 "이번주" 탭에서만 보여준다 */}
              {weekMode === "this" && (
                <MonthlyBlockCalendar
                  projectId={props.projectId}
                  userId={props.currentUserId}
                  initialDates={props.monthlyBlock
                    .filter((r) => r.user_id === props.currentUserId)
                    .map((r) => r.blocked_date)}
                  onSaved={refresh}
                />
              )}
            </div>

            {/* 모달 닫기 푸터 */}
            <div className="flex items-center justify-end px-6 py-3.5 bg-slate-50 border-t border-slate-200">
              <button
                onClick={() => setIsTimeModalOpen(false)}
                className="px-5 py-2 text-xs sm:text-sm font-bold rounded-xl bg-orange-500 hover:bg-orange-600 text-white shadow-sm transition"
              >
                완료 및 닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
