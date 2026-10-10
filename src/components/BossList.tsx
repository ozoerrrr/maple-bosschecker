"use client";

import { useMemo, useState } from "react";
import type { RawBoss, RawParty } from "@/lib/scheduling/snapshot";
import type { ScheduleSnapshot } from "@/lib/scheduling/parties";
import { DIFFICULTY_LABEL } from "@/lib/scheduling/meso";
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

// 원본 renderBossList()를 포팅: 보스별로 그룹핑해서 보여주되, 월간보스는
// weekMode와 무관하게 항상 "이번주" 모드(snapshot.confirmed 기준)로 그린다
// (사례 4에서 구현한 "월간보스는 이번주/다음주 관계없이 띄우자" 규칙).
export default function BossList(props: Props) {
  // 기본은 전부 펼친 상태 -- "접은" 보스 id만 집합으로 기억한다. 서버
  // 상태가 아니라 화면 보기 편의일 뿐이라 로컬 state로 충분하다.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapsed(bossId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(bossId)) next.delete(bossId);
      else next.add(bossId);
      return next;
    });
  }

  const sortedBosses = useMemo(
    () => [...props.bosses].sort((a, b) => a.sort_order - b.sort_order),
    [props.bosses]
  );

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

  if (sortedBosses.length === 0) {
    return (
      <div className="card sub">
        아직 등록된 보스가 없어요. 그룹 설정에서 보스와 파티를 먼저 추가해주세요.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sortedBosses.map((boss) => {
        const parties = partiesByBoss.get(boss.id) ?? [];
        const effectiveMode: "this" | "next" = boss.period === "monthly" ? "this" : props.weekMode;
        const isOpen = !collapsed.has(boss.id);
        return (
          <section key={boss.id} className="boss-group">
            <button
              type="button"
              className="boss-group-head"
              onClick={() => toggleCollapsed(boss.id)}
              aria-expanded={isOpen}
            >
              <span className="flex items-center gap-1">
                <span className={"boss-group-chevron" + (isOpen ? " open" : "")} aria-hidden="true">
                  ▶
                </span>
                {boss.name}
                {boss.difficulty && <span className={`diff-badge diff-${boss.difficulty}`}>{DIFFICULTY_LABEL[boss.difficulty]}</span>}
              </span>
              <span className="period-badge">{boss.period === "monthly" ? "월간" : "주간"}</span>
            </button>
            <div className="boss-group-body" hidden={!isOpen}>
              {parties.length === 0 ? (
                <p className="sub px-3.5 py-2">이 보스에 등록된 파티가 없어요.</p>
              ) : (
                <div className="flex flex-col">
                  {parties.map((p) => (
                    <PartyCard
                      key={p.id}
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
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
