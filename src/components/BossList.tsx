"use client";

import { useEffect, useMemo, useState } from "react";
import type { RawBoss, RawParty } from "@/lib/scheduling/snapshot";
import type { ScheduleSnapshot } from "@/lib/scheduling/parties";
import { compareBossOrder, displayBossName, formatMeso, mesoPerPerson } from "@/lib/scheduling/meso";
import DifficultyBadge from "@/components/DifficultyBadge";
import PartyCard from "@/components/PartyCard";

interface Props {
  projectId: string;
  maxPerHour: number;
  currentUserId: string;
  isOwner: boolean; // [추가] PartyCard로 넘겨 권한 판단에 사용
  weekMode: "this" | "next";
  bosses: RawBoss[];
  parties: RawParty[];
  snapshot: ScheduleSnapshot;
  memberName: (uid: string) => string;
  onChanged: () => void;
}

// [추가] 내 스케줄에서 항목을 누르면 보내는 이벤트 이름. BossList가 받아서
// 그 파티가 든 보스를 펼친 뒤 스크롤할 수 있게 한다 (보스 카드가 기본으로 닫혀 있어서 필요).
export const OPEN_PARTY_EVENT = "bosschecker:open-party";

// 원본 renderBossList()를 포팅: 보스별로 그룹핑해서 보여주되, 월간보스는
// weekMode와 무관하게 항상 "이번주" 모드(snapshot.confirmed 기준)로 그린다
// (사례 4에서 구현한 "월간보스는 이번주/다음주 관계없이 띄우자" 규칙).
export default function BossList(props: Props) {
  // [변경] 기본은 전부 닫힘(레이드 시간표와 같음) -- "연" 보스 id만 집합으로 기억한다.
  // 서버 상태가 아니라 화면 보기 편의일 뿐이라 로컬 state로 충분하다.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  // [추가] "내 파티만" 보기: 내가 파티원인 파티만 보이고, 그런 파티가 없는 보스는 숨긴다 (화면 보기 설정)
  const [onlyMine, setOnlyMine] = useState(false);

  function toggleOpen(bossId: string) {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(bossId)) next.delete(bossId);
      else next.add(bossId);
      return next;
    });
  }

  // [추가] 내 스케줄에서 파티로 이동할 때: 그 파티의 보스를 펼치고,
  // "내 파티만" 보기에서 안 보이는 파티면 전체 보기로 바꾼다.
  useEffect(() => {
    function onOpenParty(e: Event) {
      const partyId = (e as CustomEvent<string>).detail;
      const party = props.parties.find((p) => p.id === partyId);
      if (!party) return;
      setOpened((prev) => new Set(prev).add(party.boss_id));
      if (!party.members.some((m) => m.userId === props.currentUserId)) setOnlyMine(false);
    }
    window.addEventListener(OPEN_PARTY_EVENT, onOpenParty);
    return () => window.removeEventListener(OPEN_PARTY_EVENT, onOpenParty);
  }, [props.parties, props.currentUserId]);

  // [변경] 정렬 규칙은 meso.ts의 compareBossOrder (그룹 관리 화면과 같은 순서)
  const sortedBosses = useMemo(() => [...props.bosses].sort(compareBossOrder), [props.bosses]);

  const partiesByBoss = useMemo(() => {
    const m = new Map<string, RawParty[]>();
    for (const p of props.parties) {
      const arr = m.get(p.boss_id) ?? [];
      arr.push(p);
      m.set(p.boss_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [props.parties]);

  // [변경] 보여줄 보스만 미리 고른다: 파티가 없는 보스는 "전체"에서도 숨김
  const visible = sortedBosses.flatMap((boss) => {
    const allParties = partiesByBoss.get(boss.id) ?? [];
    const parties = onlyMine
      ? allParties.filter((p) => p.members.some((m) => m.userId === props.currentUserId))
      : allParties;
    return parties.length === 0 ? [] : [{ boss, parties }];
  });

  return (
    // [추가] 보스 목록 전체를 감싸는 큰 카드
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">🗓️ 보스 목록</h2>
        {/* [추가] 전체 / 내 파티만 토글 */}
        <div className="inline-flex rounded-xl border border-slate-200/60 bg-slate-100 p-1">
          {(
            [
              [false, "전체"],
              [true, "내 파티만"],
            ] as [boolean, string][]
          ).map(([v, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setOnlyMine(v)}
              className={
                "rounded-lg px-3 py-1 text-xs font-bold transition " +
                (onlyMine === v ? "bg-white text-orange-600 shadow-sm" : "text-slate-500 hover:text-slate-800")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* [추가] 도움말(? 버튼을 켰을 때만 보임) */}
      <p className="sub help-detail">
        각 파티마다 파티원 전원이 비는 시간이 드롭다운에 후보로 떠요. 즉석으로 돈 경우엔 시간을 맞추지 않고 "클리어"를
        바로 눌러도 돼요. 월간보스가 최우선이라, 월간보스 시간을 확정하면 그 주 같은 요일·시간에 한도를 넘는 주간보스
        확정을 밀어내요. 보스 이름을 누르면 그 파티들이 펼쳐지고, 오른쪽 숫자는 "확정된 파티 / 전체 파티"예요.
      </p>
      {visible.length === 0 ? (
        <p className="sub">
          {onlyMine
            ? "내가 속한 파티가 없어요."
            : "아직 파티가 등록된 보스가 없어요. 그룹 관리에서 보스와 파티를 먼저 추가해주세요."}
        </p>
      ) : (
        visible.map(({ boss, parties }) => {
          const effectiveMode: "this" | "next" = boss.period === "monthly" ? "this" : props.weekMode;
          const isOpen = opened.has(boss.id);
          // [추가] 오른쪽 요약: 확정된 파티 수 / 전체 파티 수
          // (다음주 탭은 다음주 확정 기준, 완료 여부는 세지 않음)
          const confirmedCount = parties.filter((p) =>
            effectiveMode === "this" ? !!props.snapshot.confirmed[p.id] : !!props.snapshot.nextConfirmed[p.id]
          ).length;
          // [추가] 1인당 메소: 파티 인원에 따라 달라지므로 같으면 한 값, 다르면 "최소~최대" 범위
          const mesos = parties
            .map((p) => mesoPerPerson(boss.name, boss.difficulty, p.members.length || 1))
            .filter((v): v is number => v != null);
          const mesoLabel =
            mesos.length === 0
              ? null
              : Math.min(...mesos) === Math.max(...mesos)
              ? formatMeso(mesos[0])
              : `${formatMeso(Math.min(...mesos))}~${formatMeso(Math.max(...mesos))}`;
          return (
            <section key={boss.id} className={"boss-group" + (isOpen ? " open" : "")}>
              <button
                type="button"
                className="boss-group-head"
                onClick={() => toggleOpen(boss.id)}
                aria-expanded={isOpen}
              >
                <span className="boss-group-title">
                  {displayBossName(boss.name)} {/* [변경] 화면에는 넥슨 풀네임으로 */}
                  <DifficultyBadge difficulty={boss.difficulty} /> {/* [변경] 난이도는 배지로 */}
                  {/* [변경] "주간" 표기는 없애고, 월간 보스만 작게 표시 */}
                  {boss.period === "monthly" && <span className="boss-group-note">월간</span>}
                  {/* [추가] 1인당 메소는 펼쳤을 때만 난이도 배지 옆에 표시 */}
                  {isOpen && mesoLabel && <span className="boss-group-meso">1인당 {mesoLabel}</span>}
                </span>
                <span
                  className="boss-group-summary"
                  title={`확정 ${confirmedCount} / 파티 ${parties.length}`}
                >
                  {confirmedCount}/{parties.length}
                </span>
                <span className="boss-group-chevron" aria-hidden="true">
                  ▸
                </span>
              </button>
              <div className="boss-group-body" hidden={!isOpen}>
                <div className="flex flex-col">
                  {parties.map((p, i) => (
                    <PartyCard
                      key={p.id}
                      partyIndex={i} // [추가]
                      projectId={props.projectId}
                      boss={boss}
                      party={p}
                      weekMode={effectiveMode}
                      currentUserId={props.currentUserId}
                      isOwner={props.isOwner} // [추가]
                      snapshot={props.snapshot}
                      memberName={props.memberName}
                      onChanged={props.onChanged}
                    />
                  ))}
                </div>
              </div>
            </section>
          );
        })
      )}
    </section>
  );
}
