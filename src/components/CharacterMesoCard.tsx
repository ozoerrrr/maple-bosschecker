"use client";

import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { MESO_TABLE, displayBossName, formatMeso } from "@/lib/scheduling/meso";
import DifficultyBadge from "@/components/DifficultyBadge";
import MesoProgress from "@/components/MesoProgress";
import {
  WEEKLY_CAP,
  SOLO_MAX,
  charWeek,
  clampSize,
  hasNextPlan,
  myCharacters,
  planRowsFor,
  soloBossList,
  soloPeriodKey,
  type ExtraCharRow,
  type SoloClearRow,
  type SoloPlanRow,
  type Week,
} from "@/lib/scheduling/solo";
import type { ConfirmationMap, Difficulty } from "@/lib/scheduling/types";
import { setPartyCleared } from "@/lib/scheduling/partyClear";
import type { RawBoss, RawParty } from "@/lib/scheduling/snapshot";

interface Props {
  projectId: string;
  currentUserId: string;
  weekMode: Week;
  bosses: RawBoss[];
  parties: RawParty[];
  soloPlans: SoloPlanRow[];
  soloClears: SoloClearRow[];
  extraChars: ExtraCharRow[];
  candidates: { userId: string; characterName: string }[]; // [추가] 넥슨 후보로 등록한 캐릭터 (부캐 표시용)
  confirmed: ConfirmationMap; // [추가] 이번주 파티 확정 (파티 보스 클리어 체크박스용)
  nexonLinked: boolean; // [추가] 넥슨 연동 여부 ("새로고침" 버튼 표시)
  nexonSyncing: boolean; // [추가] 넥슨 동기화 진행 중
  nexonSummary: string[]; // [추가] 마지막 동기화 결과 요약
  onRefreshNexon: () => void; // [추가] "새로고침": 인게임 스케줄러로 솔로 계획·클리어 다시 불러오기
  onChanged: () => void;
}

// [추가] 캐릭터별 메소 · 솔로 보스 카드 (레이드 시간표의 renderMeso 포팅).
// - 캐릭터마다 주간 보스 12개 한도 안에서 솔로 보스를 체크하고, 공팟 인원수를 고른다.
// - 파티로 가는 보스는 자동 포함되고 솔로 체크가 잠긴다. 넘치면 듄켈 -> 데미안 -> 루시드 순으로 빠진다.
// - 체크한 솔로 보스는 "클리어" 체크(이번주/이번달에만 유효)를 할 수 있다.
// - 이번주/다음주는 보드 상단 탭(weekMode)을 따른다. 다음주 탭에서 처음 고치면 이번주 계획을 복사한 뒤 고친다.
// 저장: solo_plans / solo_clears / extra_characters (0011, 본인 행만 쓰기 가능)
export default function CharacterMesoCard(props: Props) {
  const { projectId, currentUserId: uid, weekMode } = props;
  const supabase = createClient();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [newChar, setNewChar] = useState("");
  // 아직 난이도를 고르지 않은 보스의 인원수 (난이도를 고르면 이 값으로 저장)
  const [pendingSize, setPendingSize] = useState<Record<string, number>>({});

  const bossById = useMemo(() => new Map(props.bosses.map((b) => [b.id, b])), [props.bosses]);
  const soloBosses = useMemo(() => soloBossList(), []);
  const weeklyBosses = soloBosses.filter((b) => !b.monthly);
  const monthlyBosses = soloBosses.filter((b) => b.monthly);

  // 캐릭터별 계산 결과 (수익 높은 순 = 강한 캐릭터 순, 같으면 가나다순)
  const rows = useMemo(() => {
    const chars = myCharacters(uid, props.parties, props.extraChars, props.candidates);
    return chars
      .map((ch) => {
        const plan = planRowsFor(props.soloPlans, uid, ch, weekMode);
        const cw = charWeek(ch, uid, props.parties, bossById, plan);
        return { ch, plan, cw, total: cw.partyMeso + cw.soloMeso + cw.monthlyPartyMeso + cw.soloMonthly };
      })
      .sort((a, b) => b.total - a.total || a.ch.localeCompare(b.ch, "ko"));
  }, [uid, props.parties, props.extraChars, props.candidates, props.soloPlans, weekMode, bossById]);

  const clearKeys = useMemo(
    () =>
      new Set(
        props.soloClears
          .filter((c) => c.user_id === uid)
          .map((c) => `${c.character_name}|${c.boss_name}|${c.period_key}`)
      ),
    [props.soloClears, uid]
  );
  const isDone = (ch: string, boss: string, monthly: boolean) =>
    clearKeys.has(`${ch}|${boss}|${soloPeriodKey(monthly)}`);

  const extraSet = new Set(props.extraChars.filter((e) => e.user_id === uid).map((e) => e.character_name));

  // ----- 저장 동작 -----
  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
      props.onChanged();
    });
  }

  /** 다음주 탭에서 처음 고칠 때: 이번주 계획을 다음주 행으로 복사해 둔다. */
  async function ensureNext(ch: string) {
    if (weekMode !== "next" || hasNextPlan(props.soloPlans, uid, ch)) return;
    const thisRows = planRowsFor(props.soloPlans, uid, ch, "this");
    if (!thisRows.length) return;
    await supabase.from("solo_plans").upsert(
      thisRows.map((r) => ({
        project_id: projectId,
        user_id: uid,
        character_name: ch,
        boss_name: r.boss_name,
        difficulty: r.difficulty,
        party_size: r.party_size,
        week: "next" as const,
      }))
    );
  }

  function toggleSolo(ch: string, boss: string, diff: Difficulty, monthly: boolean) {
    const row = rows.find((r) => r.ch === ch);
    if (!row || row.cw.party[boss] || row.cw.mparty[boss]) return;
    const cur = row.plan.find((p) => p.boss_name === boss);
    if (!monthly && !cur && row.cw.count >= WEEKLY_CAP) return; // 12개가 찼으면 새 보스는 못 고른다
    run(async () => {
      await ensureNext(ch);
      if (cur && cur.difficulty === diff) {
        await supabase
          .from("solo_plans")
          .delete()
          .match({ project_id: projectId, user_id: uid, character_name: ch, boss_name: boss, week: weekMode });
      } else {
        await supabase.from("solo_plans").upsert({
          project_id: projectId,
          user_id: uid,
          character_name: ch,
          boss_name: boss,
          difficulty: diff,
          party_size: clampSize(boss, cur?.party_size ?? pendingSize[`${ch}|${boss}`]),
          week: weekMode,
        });
      }
    });
  }

  function setSize(ch: string, boss: string, n: number) {
    const row = rows.find((r) => r.ch === ch);
    const cur = row?.plan.find((p) => p.boss_name === boss);
    if (!cur) {
      setPendingSize((prev) => ({ ...prev, [`${ch}|${boss}`]: n })); // 아직 체크 전이면 화면에만 기억
      return;
    }
    run(async () => {
      await ensureNext(ch);
      await supabase
        .from("solo_plans")
        .update({ party_size: clampSize(boss, n), updated_at: new Date().toISOString() })
        .match({ project_id: projectId, user_id: uid, character_name: ch, boss_name: boss, week: weekMode });
    });
  }

  function setDone(ch: string, boss: string, monthly: boolean, on: boolean) {
    const key = { project_id: projectId, user_id: uid, character_name: ch, boss_name: boss, period_key: soloPeriodKey(monthly) };
    run(async () => {
      if (on) await supabase.from("solo_clears").upsert(key);
      else await supabase.from("solo_clears").delete().match(key);
    });
  }

  // [추가] 파티로 가는 보스의 클리어 체크 = 그 파티의 클리어 상태 (스케줄 보스 목록의 "클리어 ✓"와 같은 값)
  function setPartyDone(partyId: string, on: boolean) {
    run(() => setPartyCleared(supabase, partyId, props.confirmed[partyId], on, uid));
  }

  /** 캐릭터의 솔로 보스 일괄 클리어: 하나라도 안 했으면 전부 체크, 전부 했으면 전부 해제. */
  function bulkDone(ch: string) {
    const row = rows.find((r) => r.ch === ch);
    if (!row) return;
    const items = [...row.cw.ok, ...row.cw.monthlyOk];
    if (!items.length) return;
    const allDone = items.every((it) => isDone(ch, it.name, it.monthly));
    const keys = items.map((it) => ({
      project_id: projectId,
      user_id: uid,
      character_name: ch,
      boss_name: it.name,
      period_key: soloPeriodKey(it.monthly),
    }));
    run(async () => {
      if (allDone) {
        for (const k of keys) await supabase.from("solo_clears").delete().match(k);
      } else {
        await supabase.from("solo_clears").upsert(keys, { ignoreDuplicates: true });
      }
    });
  }

  function addChar() {
    const name = newChar.trim();
    if (!name) return;
    setNewChar("");
    if (rows.some((r) => r.ch === name)) return;
    setOpen((prev) => new Set(prev).add(name));
    run(async () => {
      await supabase.from("extra_characters").upsert({ project_id: projectId, user_id: uid, character_name: name });
    });
  }

  function removeExtra(ch: string) {
    run(async () => {
      await supabase.from("extra_characters").delete().match({ project_id: projectId, user_id: uid, character_name: ch });
      await supabase.from("solo_plans").delete().match({ project_id: projectId, user_id: uid, character_name: ch });
    });
  }

  // [추가] 이번주 획득 메소: 클리어한 보스만 더한다 (파티 보스 = 그 파티가 클리어, 솔로 = 클리어 체크).
  // 메소 카드의 클리어 체크박스와 같은 기준. 월간은 따로 센다.
  function earnedOf(row: (typeof rows)[number]) {
    const { ch, cw } = row;
    const partyDone = (e: { partyId: string; meso: number | null }) =>
      props.confirmed[e.partyId]?.cleared ? e.meso ?? 0 : 0;
    const weekly =
      Object.values(cw.party).reduce((s, e) => s + partyDone(e), 0) +
      cw.ok.reduce((s, it) => s + (isDone(ch, it.name, false) ? it.meso : 0), 0);
    const monthly =
      Object.values(cw.mparty).reduce((s, e) => s + partyDone(e), 0) +
      cw.monthlyOk.reduce((s, it) => s + (isDone(ch, it.name, true) ? it.meso : 0), 0);
    return { weekly, monthly };
  }
  const earnedSum = rows.reduce(
    (s, r) => {
      const e = earnedOf(r);
      return { weekly: s.weekly + e.weekly, monthly: s.monthly + e.monthly };
    },
    { weekly: 0, monthly: 0 }
  );
  const showEarned = weekMode === "this"; // 다음주 탭은 아직 클리어가 없어 총 메소만

  // ----- 합계 -----
  const sum = rows.reduce(
    (s, r) => ({
      party: s.party + r.cw.partyMeso,
      solo: s.solo + r.cw.soloMeso,
      monthly: s.monthly + r.cw.monthlyPartyMeso + r.cw.soloMonthly,
    }),
    { party: 0, solo: 0, monthly: 0 }
  );

  function bossRow(ch: string, row: (typeof rows)[number], b: (typeof soloBosses)[number]) {
    const inParty = b.monthly ? row.cw.mparty[b.name] : row.cw.party[b.name];
    const cur = row.plan.find((p) => p.boss_name === b.name);
    const maxSize = SOLO_MAX[b.name] ?? 1;
    const size = clampSize(b.name, cur?.party_size ?? pendingSize[`${ch}|${b.name}`]);
    const counted = cur && !row.cw.excluded.has(b.name);
    return (
      <div key={b.name} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 py-1.5">
        <div className="w-28 shrink-0 text-[13px] font-semibold text-slate-700">{displayBossName(b.name)}</div>
        {inParty && (
          <div className="text-xs text-slate-500">
            파티로 진행 중
            <DifficultyBadge difficulty={inParty.difficulty} className="ml-1" />
            {inParty.meso != null && <> · {formatMeso(inParty.meso)}</>}
          </div>
        )}
        {/* [추가] 파티 보스도 클리어 체크 (이번주만). 체크하면 그 파티가 클리어 처리된다 */}
        {inParty && weekMode === "this" && (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1 text-xs text-slate-500">
            <input
              type="checkbox"
              className="!p-0"
              disabled={isPending}
              checked={!!props.confirmed[inParty.partyId]?.cleared}
              onChange={(e) => setPartyDone(inParty.partyId, e.target.checked)}
            />
            클리어
          </label>
        )}
        {!inParty && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {maxSize > 1 && (
              <select
                value={size}
                disabled={isPending}
                onChange={(e) => setSize(ch, b.name, parseInt(e.target.value, 10))}
                aria-label={`${b.name} 인원수`}
                className="!py-1 !pl-2 text-xs"
              >
                {Array.from({ length: maxSize }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "솔로" : `${n}인`}
                  </option>
                ))}
              </select>
            )}
            {b.diffs.map((d) => {
              const sel = cur?.difficulty === d;
              const disabled = isPending || (!b.monthly && !sel && !cur && row.cw.count >= WEEKLY_CAP);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={disabled}
                  aria-pressed={sel}
                  onClick={() => toggleSolo(ch, b.name, d, b.monthly)}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold transition disabled:opacity-40 " +
                    (sel
                      ? row.cw.excluded.has(b.name)
                        ? "border-dashed border-orange-300 bg-orange-50 text-orange-400 line-through"
                        : "border-orange-400 bg-orange-50 text-orange-600"
                      : "border-slate-200 bg-white text-slate-600 hover:border-orange-300")
                  }
                >
                  <DifficultyBadge difficulty={d} />
                  {formatMeso((MESO_TABLE[b.name][d] as number) / size)}
                </button>
              );
            })}
            {counted && (
              <label className="ml-auto inline-flex cursor-pointer items-center gap-1 text-xs text-slate-500">
                <input
                  type="checkbox"
                  className="!p-0"
                  disabled={isPending}
                  checked={isDone(ch, b.name, b.monthly)}
                  onChange={(e) => setDone(ch, b.name, b.monthly, e.target.checked)}
                />
                클리어
              </label>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">
          🪙 캐릭터별 메소 · 솔로 보스
          {/* [변경] "○○주 기준" 글자 대신 제목 옆 "다음주" 표시로 (이번주는 표시 없음) */}
          {weekMode === "next" && <span className="ml-2 text-xs font-bold text-sky-600">다음주</span>}
        </h2>
        <div className="flex items-center gap-2">
          {/* [추가] 넥슨 인게임 스케줄러로 솔로 계획·클리어 다시 불러오기 (넥슨 연동한 사람만) */}
          {props.nexonLinked && (
            <button
              type="button"
              onClick={props.onRefreshNexon}
              disabled={props.nexonSyncing}
              className="btn-secondary !px-3 !py-1 text-xs"
            >
              {props.nexonSyncing ? "불러오는 중…" : "넥슨 불러오기"} {/* [변경] 상단 ↻(최신 내용 불러오기)와 이름이 겹치지 않게 */}
            </button>
          )}
        </div>
      </div>
      {/* [추가] 도움말(? 버튼을 켰을 때만 보임) */}
      <p className="sub help-detail">
        캐릭터 하나는 주간 보스를 12개까지 돌 수 있고, 같은 보스는 난이도와 상관없이 1개로 세요. 파티로 가는 보스는
        자동으로 들어가요. 솔로 계획과 클리어는 넥슨 스케줄러로 자동으로 채워져요(스케줄 페이지에 들어올 때, "넥슨 불러오기"를
        누를 때). 예상과 다르면 여기서 직접 고치면 돼요. 오른쪽 금액은 "이번주 획득 메소 / 총 메소"예요.
      </p>
      {/* [추가] 마지막 넥슨 동기화 결과 -- [변경] 도움말을 켰을 때만 보임 */}
      {props.nexonSummary.length > 0 && !props.nexonSyncing && (
        <div className="help-detail">
          {props.nexonSummary.map((s) => (
            <p key={s} className="text-xs text-slate-500">
              {s}
            </p>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <p className="text-sm text-slate-600">
          {showEarned ? (
            <>
              {/* [변경] 이번주: "획득 / 총" 메소(다 모으면 같은 색) + 잔여 메소(총 - 획득) */}
              내 캐릭터 합계{" "}
              <strong>
                <MesoProgress earned={earnedSum.weekly} total={sum.party + sum.solo} />
              </strong>{" "}
              (잔여 메소 {formatMeso(Math.max(0, sum.party + sum.solo - earnedSum.weekly))})
            </>
          ) : (
            <>
              {/* [변경] 다음주: 예상 메소만 */}
              다음주 예상 메소: <strong className="text-orange-600">{formatMeso(sum.party + sum.solo)}</strong>
            </>
          )}
          {sum.monthly > 0 && (
            <>
              {/* [변경] 월간은 다음 줄로 */}
              <br />
              월간(별도){" "}
              <strong>
                {showEarned ? (
                  <MesoProgress earned={earnedSum.monthly} total={sum.monthly} tone="purple" />
                ) : (
                  <span className="text-purple-600">{formatMeso(sum.monthly)}</span>
                )}
              </strong>
            </>
          )}
        </p>
      )}

      {rows.length === 0 && (
        <p className="sub">표시할 캐릭터가 없어요. 파티에 들어가거나 아래에서 캐릭터를 추가해 주세요.</p>
      )}

      {rows.map((row) => {
        const { ch, cw } = row;
        const isOpen = open.has(ch);
        const full = cw.count >= WEEKLY_CAP;
        const doneItems = [...cw.ok, ...cw.monthlyOk];
        const allDone = doneItems.length > 0 && doneItems.every((it) => isDone(ch, it.name, it.monthly));
        return (
          <div key={ch} className="rounded-xl border border-slate-200 bg-slate-50/60">
            <button
              type="button"
              onClick={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(ch)) next.delete(ch);
                  else next.add(ch);
                  return next;
                })
              }
              aria-expanded={isOpen}
              className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 text-left"
            >
              <span className="text-xs text-slate-400">{isOpen ? "▾" : "▸"}</span>
              <span className="text-sm font-bold text-slate-800">{ch}</span>
              <span className={"text-xs " + (full ? "font-bold text-amber-600" : "text-slate-500")}>
                보스 {cw.count}/{WEEKLY_CAP}
              </span>
              {/* [변경] 이번주 획득 메소 / 총 메소 (다음주 탭은 총 메소만) */}
              <span className="ml-auto text-sm font-bold">
                {/* [변경] 획득/총 색 구분 (다 모으면 같은 색) */}
                {showEarned ? (
                  <MesoProgress earned={earnedOf(row).weekly} total={cw.partyMeso + cw.soloMeso} />
                ) : (
                  <span className="text-orange-600">{formatMeso(cw.partyMeso + cw.soloMeso)}</span>
                )}
              </span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    주간: 파티 {formatMeso(cw.partyMeso)} + 솔로 {formatMeso(cw.soloMeso)}
                    {/* [추가] 이번주 탭: 잔여 메소(총 - 이번주 획득) */}
                    {showEarned &&
                      `(잔여 ${formatMeso(Math.max(0, cw.partyMeso + cw.soloMeso - earnedOf(row).weekly))})`}
                    {/* [변경] 월간은 다음 줄로 (합계 줄과 같게) */}
                    {cw.monthlyPartyMeso + cw.soloMonthly > 0 && (
                      <>
                        <br />
                        월간(별도): 파티 {formatMeso(cw.monthlyPartyMeso)} + 솔로 {formatMeso(cw.soloMonthly)}
                      </>
                    )}
                  </span>
                  {doneItems.length > 0 && (
                    <button type="button" disabled={isPending} onClick={() => bulkDone(ch)} className="underline">
                      {allDone ? "솔로 클리어 전부 해제" : "솔로 전부 클리어"}
                    </button>
                  )}
                </div>
                {cw.bad.map((b) => (
                  <p key={b.it.name} className="mt-1 text-xs text-amber-600">
                    {displayBossName(b.it.name)} <DifficultyBadge difficulty={b.it.diff} />
                    {b.it.size > 1 ? ` (${b.it.size}인)` : ""} —{" "}
                    {b.why === "party"
                      ? "파티로 같은 보스를 가서 계산에서 빠져요"
                      : "12개를 넘어서 계산에서 빠져요 (듄켈 → 데미안 → 루시드 순)"}
                  </p>
                ))}
                <div className="mt-2">{weeklyBosses.map((b) => bossRow(ch, row, b))}</div>
                {monthlyBosses.length > 0 && (
                  <>
                    <p className="mt-3 text-xs text-slate-500">월간 보스 (12개 한도와 별개)</p>
                    {monthlyBosses.map((b) => bossRow(ch, row, b))}
                  </>
                )}
                {extraSet.has(ch) && cw.partyNames.length === 0 && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => removeExtra(ch)}
                    className="mt-2 text-xs text-slate-500 underline"
                  >
                    이 캐릭터 목록에서 빼기
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <input
          value={newChar}
          maxLength={20}
          onChange={(e) => setNewChar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addChar();
          }}
          placeholder="파티 없는 캐릭터 이름 추가"
          className="min-w-[140px] flex-1 text-sm"
        />
        <button type="button" disabled={isPending || !newChar.trim()} onClick={addChar} className="btn-secondary text-sm">
          캐릭터 추가
        </button>
      </div>
    </section>
  );
}
