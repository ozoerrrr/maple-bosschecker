"use client";

// [추가] 0020: 스케줄 페이지의 "📅 ○월 ○일(목)부터 바뀌는 파티" 공지 카드 (레이드 시간표의 "예약된 변경사항" 카드).
// 그룹 관리 다음주 탭에서 "다음주 따로"로 고친 보스마다 이번주 파티와 다음주 파티를 비교해서
//   - 보스 줄: 이름 + 난이도 · 파티 수 변화 · 메모(bosses.next_note)
//   - 들어옴 / 빠짐: 사람+캐릭터 기준으로 다음주에 새로 들어오는 사람, 빠지는 사람
//   - "다음주 구성 보기": 다음주 파티 전체 구성
//   - 맨 아래 "🙋 내 변경 사항": 나에게 해당하는 변경(새로 참여, 빠짐, 캐릭터 변경)
// 을 보여준다. 실제로 구성이 바뀐 보스가 없으면 카드를 그리지 않는다.
import { useMemo } from "react";
import { useCardOpen } from "@/lib/useCardOpen"; // [추가] 카드 접기/펴기
import DifficultyBadge from "@/components/DifficultyBadge";
import { compareBossOrder, displayBossName } from "@/lib/scheduling/meso";
import { nextWeekStartStr, parseDateKey } from "@/lib/scheduling/dates";
import type { RawBoss, RawParty } from "@/lib/scheduling/snapshot";

interface Props {
  projectId: string; // [추가] 카드 접힘 상태를 그룹별로 기억
  currentUserId: string;
  bosses: RawBoss[];
  parties: RawParty[]; // 이번주 파티
  nextParties: RawParty[]; // 다음주에 보일 파티
  memberName: (uid: string) => string;
  onOpenBoss: (bossId: string) => void; // "다음주 탭에서 보기": 토글을 다음주로 바꾸고 그 보스를 연다
}

type Member = RawParty["members"][number];

/** 파티 이름 (이름이 없으면 보스 안에서 "N파티") */
function partyLabel(p: RawParty, i: number) {
  return p.label || `${i + 1}파티`;
}

/** 사람+캐릭터 키 (같은 사람이 다른 캐릭터로 바뀌면 다른 키) */
const keyOf = (m: Member) => `${m.userId}|${m.characterName ?? ""}`;

/** 파티 구성을 비교하기 좋게 정리: 파티마다 정렬한 멤버 키 목록, 파티 순서대로 */
function normalize(list: RawParty[]) {
  return list.map((p) => p.members.map(keyOf).sort().join(",")).sort().join(" / ");
}

export default function NextWeekNoticeCard({ projectId, currentUserId: me, bosses, parties, nextParties, memberName, onOpenBoss }: Props) {
  // [추가] 카드 접기/펴기 (기본 펼침, 이 브라우저에 기억). 아래 early return보다 먼저 불러야 한다
  const [cardOpen, toggleCard] = useCardOpen(`${projectId}:next-week-notice`);
  // 사람 표시: "캐릭터명" (캐릭터가 없으면 사람 이름)
  const who = (m: Member) => m.characterName || memberName(m.userId);

  const items = useMemo(() => {
    const byBoss = (list: RawParty[], bossId: string) =>
      list.filter((p) => p.boss_id === bossId).sort((a, b) => a.sort_order - b.sort_order);
    return [...bosses]
      .filter((b) => b.next_custom && b.period === "weekly")
      .sort(compareBossOrder)
      .flatMap((boss) => {
        const before = byBoss(parties, boss.id);
        const after = byBoss(nextParties, boss.id);
        if (normalize(before) === normalize(after)) return []; // 다음주 따로지만 실제로는 같음

        const beforeKeys = new Map(before.flatMap((p) => p.members.map((m) => [keyOf(m), m] as const)));
        const afterKeys = new Map(after.flatMap((p) => p.members.map((m) => [keyOf(m), m] as const)));
        const joined = [...afterKeys].filter(([k]) => !beforeKeys.has(k)).map(([, m]) => m);
        const left = [...beforeKeys].filter(([k]) => !afterKeys.has(k)).map(([, m]) => m);

        // 나에게 해당하는 변경
        const mineIn = (list: RawParty[]) =>
          list.flatMap((p, i) =>
            p.members.filter((m) => m.userId === me).map((m) => ({ char: m.characterName ?? "", party: partyLabel(p, i) }))
          );
        const myBefore = mineIn(before);
        const myAfter = mineIn(after);
        // [변경] "보스_변경점_상세내용"으로 보이도록 변경점(kind)과 상세(detail)를 나눠 담는다
        const mine: { kind: string; detail?: string }[] = [];
        if (!myBefore.length && myAfter.length) {
          mine.push({ kind: "새로 참여", detail: myAfter.map((x) => x.char || x.party).join(", ") });
        } else if (myBefore.length && !myAfter.length) {
          mine.push({ kind: "빠짐" });
        } else if (myBefore.length && myAfter.length) {
          const bc = myBefore.map((x) => x.char).sort().join(",");
          const ac = myAfter.map((x) => x.char).sort().join(",");
          // [변경] "캐릭터 교체" -> "캐릭터 변경" (일부 캐릭터만 빠지거나 더해진 경우도 포함하는 표현)
          if (bc !== ac) {
            mine.push({
              kind: "캐릭터 변경",
              detail: `${myBefore.map((x) => x.char || "미지정").join(", ")} → ${myAfter.map((x) => x.char || "미지정").join(", ")}`,
            });
          }
          // [변경] 캐릭터가 같으면 파티 이름이 달라도 표시하지 않는다
        }
        return [{ boss, before, after, joined, left, mine }];
      });
  }, [bosses, parties, nextParties, me]);

  if (items.length === 0) return null;

  const { month0, day } = parseDateKey(nextWeekStartStr());
  const myLines = items.filter((it) => it.mine.length);

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-base font-bold text-slate-900">
        {/* [추가] 제목을 누르면 카드 접기/펴기 */}
        <button type="button" className="card-toggle" onClick={toggleCard} aria-expanded={cardOpen}>
          <span className="card-toggle-chevron" aria-hidden="true">▸</span>
          📅 {month0 + 1}월 {day}일(목)부터 바뀌는 파티
        </button>
      </h2>
      {cardOpen && (
      <>
      <div className="flex flex-col gap-2">
        {items.map(({ boss, before, after, joined, left }) => (
          <div key={boss.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-bold text-slate-800">{displayBossName(boss.name)}</span>
              <DifficultyBadge difficulty={boss.difficulty} />
              <span className="text-xs text-slate-500">
                · 파티 {before.length} → {after.length}
              </span>
              {boss.next_note && <span className="text-xs font-semibold text-sky-700">· “{boss.next_note}”</span>}
              <button type="button" onClick={() => onOpenBoss(boss.id)} className="ml-auto text-xs text-slate-500 underline">
                다음주 탭에서 보기
              </button>
            </div>
            {(joined.length > 0 || left.length > 0) && (
              <p className="mt-1 text-xs text-slate-600">
                {joined.length > 0 && (
                  <>
                    <span className="font-bold text-emerald-600">들어옴</span> {joined.map(who).join(", ")}
                  </>
                )}
                {/* [변경] 들어옴과 빠짐은 줄을 나눈다 */}
                {joined.length > 0 && left.length > 0 && <br />}
                {left.length > 0 && (
                  <>
                    <span className="font-bold text-red-500">빠짐</span> {left.map(who).join(", ")}
                  </>
                )}
              </p>
            )}
            {joined.length === 0 && left.length === 0 && (
              <p className="mt-1 text-xs text-slate-600">같은 사람들끼리 파티 구성만 바뀌어요.</p>
            )}
            <details className="mt-1 text-xs text-slate-500">
              <summary className="cursor-pointer">다음주 구성 보기</summary>
              <ul className="mt-1 flex flex-col gap-0.5 pl-2">
                {after.length === 0 && <li>다음주 파티 없음</li>}
                {after.map((p, i) => (
                  <li key={p.id}>
                    <span className="font-semibold text-slate-700">{partyLabel(p, i)}</span>{" "}
                    {p.members.length ? p.members.map(who).join(", ") : "멤버 없음"}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
      </div>
      {/* [변경] "내 변경 사항"은 보스마다 한 줄씩 */}
      {myLines.length > 0 && (
        <div className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-slate-700">
          <span className="font-bold text-orange-600">🙋 내 변경 사항</span>
          {myLines.map((it) => (
            <span key={it.boss.id} className="block">
              · {displayBossName(it.boss.name)}
              {it.boss.difficulty ? " " + it.boss.difficulty.toUpperCase() : ""}
              {it.mine.map((m) => `_${m.kind}${m.detail ? `_${m.detail}` : ""}`).join(", ")}
            </span>
          ))}
        </div>
      )}
      </>
      )}
    </section>
  );
}
