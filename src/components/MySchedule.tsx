"use client";

import { useMemo, useState } from "react";
import { DAY_INDEX, type Day } from "@/lib/scheduling/constants";
import DifficultyBadge from "@/components/DifficultyBadge";
import { parseDateKey, weekdayLabelForDate } from "@/lib/scheduling/dates";
import type { RawBoss, RawConfirmationRow, RawNextConfirmationRow, RawParty } from "@/lib/scheduling/snapshot";

interface Props {
  currentUserId: string;
  bosses: RawBoss[];
  parties: RawParty[];
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
export default function MySchedule({ currentUserId: me, bosses, parties, confirmations, nextConfirmations, memberName }: Props) {
  const [view, setView] = useState<View>("all");

  const items = useMemo(() => {
    const bossById = new Map(bosses.map((b) => [b.id, b]));
    const confBy = new Map(confirmations.map((c) => [c.party_id, c]));
    const nextBy = new Map(nextConfirmations.map((c) => [c.party_id, c]));
    const out: Item[] = [];
    for (const p of parties) {
      if (!p.members.some((m) => m.userId === me)) continue;
      const boss = bossById.get(p.boss_id);
      if (!boss) continue;
      const c = confBy.get(p.id);
      if (c?.cleared) continue;
      const bossOrder = String(boss.sort_order).padStart(4, "0");
      if (boss.period === "monthly" && c?.confirmed_date && c.hour != null) {
        const { year, month0, day } = parseDateKey(c.confirmed_date);
        out.push({
          party: p,
          boss,
          kind: "monthly",
          sortKey: `${c.confirmed_date}-${String(c.hour).padStart(2, "0")}`,
          when: `${month0 + 1}/${day} (${weekdayLabelForDate(year, month0, day)}) ${c.hour}시`,
        });
      } else if (boss.period === "weekly" && c?.day && c.hour != null) {
        out.push({
          party: p,
          boss,
          kind: "weekly",
          sortKey: `${DAY_INDEX[c.day as Day]}-${String(c.hour).padStart(2, "0")}`,
          when: `${c.day} ${c.hour}시`,
        });
      } else {
        out.push({ party: p, boss, kind: "pending", sortKey: bossOrder, when: "미확정" });
      }
      const n = nextBy.get(p.id);
      if (boss.period === "weekly" && n?.day && n.hour != null) {
        out.push({
          party: p,
          boss,
          kind: "next",
          sortKey: `${DAY_INDEX[n.day as Day]}-${String(n.hour).padStart(2, "0")}`,
          when: `다음주 ${n.day} ${n.hour}시`,
        });
      }
    }
    return out;
  }, [bosses, parties, confirmations, nextConfirmations, me]);

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
    const el = document.getElementById(`party-${partyId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-orange-400", "rounded-lg");
    setTimeout(() => el.classList.remove("ring-2", "ring-orange-400", "rounded-lg"), 1600);
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
        <h2 className="text-base font-bold text-slate-900">📋 내 스케줄</h2>
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
                  <span className={"w-28 shrink-0 text-sm font-bold " + kindStyle[it.kind]}>{it.when}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-slate-800">
                      {it.boss.name}
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
