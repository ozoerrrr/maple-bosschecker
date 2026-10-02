"use client";

import { useMemo } from "react";
import type { RawBoss, RawParty } from "@/lib/scheduling/snapshot";
import type { ScheduleSnapshot } from "@/lib/scheduling/parties";
import PartyCard from "@/components/PartyCard";

interface Props {
  projectId: string;
  maxPerHour: number;
  currentUserId: string;
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
      <div className="card text-sm text-slate-500">
        아직 등록된 보스가 없어요. 그룹 설정에서 보스와 파티를 먼저 추가해주세요.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sortedBosses.map((boss) => {
        const parties = partiesByBoss.get(boss.id) ?? [];
        const effectiveMode: "this" | "next" = boss.period === "monthly" ? "this" : props.weekMode;
        return (
          <section key={boss.id} className="card">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="font-semibold">{boss.name}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
                {boss.period === "monthly" ? "월간" : "주간"}
              </span>
            </div>
            {parties.length === 0 ? (
              <p className="text-xs text-slate-400">이 보스에 등록된 파티가 없어요.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {parties.map((p) => (
                  <PartyCard
                    key={p.id}
                    projectId={props.projectId}
                    party={p}
                    weekMode={effectiveMode}
                    currentUserId={props.currentUserId}
                    snapshot={props.snapshot}
                    memberName={props.memberName}
                    onChanged={props.onChanged}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
