"use client";

import { useMemo, useState } from "react";
import { DAY_INDEX, type Day } from "@/lib/scheduling/constants";
import DifficultyBadge from "@/components/DifficultyBadge";
import { OPEN_PARTY_EVENT } from "@/components/BossList"; // [추가]
import { dateSlotLabel, slotLabel } from "@/lib/scheduling/dates";
import { displayBossName } from "@/lib/scheduling/meso";
import type { RawBoss, RawConfirmationRow, RawNextConfirmationRow, RawParty } from "@/lib/scheduling/snapshot";

interface Props {
  currentUserId: string;
  bosses: RawBoss[];
  parties: RawParty[];
  nextParties: RawParty[]; // [추가] 0017: 다음주에 보일 파티
  weekMode: "this" | "next"; // [추가] 다음주 미리입력 토글
  confirmations: RawConfirmationRow[];
  nextConfirmations: RawNextConfirmationRow[];
  memberName: (uid: string) => string;
}

type View = "all" | "people" | "char";
type Kind = "monthly" | "weekly" | "next" | "pending";

interface Item {
  party: RawParty;
  boss: RawBoss;
  kind: Kind;
  sortKey: string; // 같은 묶음 안 정렬용
  when: string; // 화면 표시용 시간
}

const KIND_ORDER: Record<Kind, number> = { monthly: 0, weekly: 1, next: 2, pending: 3 };

// [추가] 내 스케줄 카드 (레이드 시간표의 renderMySchedule 포팅).
// 내가 속한 파티를 월간 확정 -> 주간 확정 -> 다음주 미리확정 -> 미확정 순으로 모아 보여준다.
// [전체보기 / 사람별 / 캐릭별] 토글로 묶는 기준을 바꾸고, 항목을 누르면 보스 목록의 그 파티로 이동한다.
// 이미 완료(클리어)한 파티는 보여주지 않는다.
export default function MySchedule({ currentUserId: me, bosses, parties, nextParties, weekMode, confirmations, nextConfirmations, memberName }: Props) {
  const [view, setView] = useState<View>("all");

  const items = useMemo(() => {
    const bossById = new Map(bosses.map((b) => [b.id, b]));
    const confBy = new Map(confirmations.map((c) => [c.party_id, c]));
    const nextBy = new Map(nextConfirmations.map((c) => [c.party_id, c]));
    const out: Item[] = [];
    // [변경] 이번주 탭은 이번주 파티의 확정/미확정, 다음주 탭은 다음주 파티의 미리확정/미확정을 보여준다.
    // 월간 보스는 주 구분이 없어서 두 탭 모두 같은 파티·같은 확정으로 보인다.
    for (const p of weekMode === "next" ? nextParties : parties) {
      if (!p.members.some((m) => m.userId === me)) continue;
      const boss = bossById.get(p.boss_id);
      if (!boss) continue;
      const c = confBy.get(p.id);
      const bossOrder = String(boss.sort_order).padStart(4, "0");
      if (weekMode === "next" && boss.period === "weekly") {
        const n = nextBy.get(p.id);
        if (n?.day && n.hour != null) {
          out.push({
            party: p,
            boss,
            kind: "next",
            sortKey: `${DAY_INDEX[n.day as Day]}-${String(n.hour).padStart(2, "0")}`,
            when: `다음주\n${slotLabel(n.day as Day, n.hour)}`, // 다음주 ⏎ 목 21시
          });
        } else {
          out.push({ party: p, boss, kind: "pending", sortKey: bossOrder, when: "미확정" });
        }
        continue;
      }
      if (c?.cleared) continue;
      if (boss.period === "monthly" && c?.confirmed_date && c.hour != null) {
        out.push({
          party: p,
          boss,
          kind: "monthly",
          sortKey: `${c.confirmed_date}-${String(c.hour).padStart(2, "0")}`,
          when: dateSlotLabel(c.confirmed_date, c.hour, "\n"), // [변경] 10/3 (토) ⏎ 21시 (레이드 시간표와 같은 두 줄)
        });
      } else if (boss.period === "weekly" && c?.day && c.hour != null) {
        out.push({
          party: p,
          boss,
          kind: "weekly",
          sortKey: `${DAY_INDEX[c.day as Day]}-${String(c.hour).padStart(2, "0")}`,
          when: slotLabel(c.day as Day, c.hour), // [변경] 공통 표기 함수
        });
      } else {
        out.push({ party: p, boss, kind: "pending", sortKey: bossOrder, when: "미확정" });
      }
    }
    return out;
  }, [bosses, parties, nextParties, weekMode, confirmations, nextConfirmations, me]);

  // 묶음 나누기: 전체 = 하나, 캐릭별 = 내 캐릭터 이름, 사람별 = 같이 가는 사람마다(여러 묶음에 들어갈 수 있음)
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    const add = (key: string, it: Item) => {
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    };
    for (const it of items) {
      if (view === "all") add("", it);
      else if (view === "char") {
        add(it.party.members.find((m) => m.userId === me)?.characterName || "캐릭터 미지정", it);
      } else {
        const others = it.party.members.filter((m) => m.userId !== me);
        if (!others.length) add("혼자", it);
        for (const o of others) add(memberName(o.userId), it);
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sortKey.localeCompare(b.sortKey));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [items, view, me, memberName]);

  // 항목을 누르면 보스 목록의 그 파티로 스크롤하고 잠깐 강조한다 (PartyCard의 id="party-<id>")
  function goToParty(partyId: string) {
    // [추가] 보스 카드가 기본으로 닫혀 있으므로 먼저 그 보스를 펼치게 하고, 다시 그려진 뒤 스크롤한다
    window.dispatchEvent(new CustomEvent(OPEN_PARTY_EVENT, { detail: partyId }));
    setTimeout(() => {
      const el = document.getElementById(`party-${partyId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-orange-400", "rounded-lg");
      setTimeout(() => el.classList.remove("ring-2", "ring-orange-400", "rounded-lg"), 1600);
    }, 60);
  }

  const kindStyle: Record<Kind, string> = {
    monthly: "text-purple-600",
    weekly: "text-orange-600",
    next: "text-sky-600",
    pending: "text-slate-400",
  };

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">
          📋 내 스케줄
          {/* [추가] 다음주 미리입력 토글을 켰을 때 표시 */}
          {weekMode === "next" && <span className="ml-2 text-xs font-bold text-sky-600">다음주</span>}
        </h2>
        <div className="inline-flex rounded-xl border border-slate-200/60 bg-slate-100 p-1">
          {(
            [
              ["all", "전체보기"],
              ["people", "사람별"],
              ["char", "캐릭별"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={
                "rounded-lg px-3 py-1 text-xs font-bold transition " +
                (view === v ? "bg-white text-orange-600 shadow-sm" : "text-slate-500 hover:text-slate-800")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="sub">아직 남은 일정이 없어요. 보스 목록에서 시간을 확정하면 여기에 모여요.</p>
      ) : (
        groups.map(([key, arr]) => (
          <div key={key || "all"} className="flex flex-col gap-1.5">
            {key && <h3 className="border-b border-slate-200 pb-1 text-sm font-bold text-orange-600">{key}</h3>}
            {arr.map((it) => {
              const others = it.party.members
                .filter((m) => m.userId !== me)
                .map((m) => memberName(m.userId))
                .join(", ");
              return (
                <button
                  key={`${it.kind}-${it.party.id}`}
                  type="button"
                  onClick={() => goToParty(it.party.id)}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-orange-300"
                >
                  <span className={"w-28 shrink-0 whitespace-pre-line text-sm font-bold leading-tight " + kindStyle[it.kind]}>{it.when}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-slate-800">
                      {displayBossName(it.boss.name)} {/* [변경] 화면에는 넥슨 풀네임으로 */}
                      <DifficultyBadge difficulty={it.boss.difficulty} className="ml-1.5" />
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {it.party.label || "파티"}
                      {others ? ` · ${others}` : " · 혼자"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}
