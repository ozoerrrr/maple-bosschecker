"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BOSS_CATALOG, DIFFICULTIES, compareBossOrder, difficultiesOf, displayBossName, parseTrailingDifficulty } from "@/lib/scheduling/meso";
import DifficultyBadge from "@/components/DifficultyBadge";
import type { Difficulty } from "@/lib/scheduling/types";
import { isMonthlyBossName, partyMaxOf } from "@/lib/scheduling/solo";

// [추가] 보스 드롭다운에서 "직접 입력…"을 뜻하는 값
const CUSTOM_BOSS = "__custom__";

interface Boss {
  id: string;
  name: string;
  period: "weekly" | "monthly";
  difficulty: Difficulty | null;
  sort_order: number;
  next_custom?: boolean; // [추가] 0017: 다음주 파티를 이번주와 따로 짰는지
}

interface PartyMember {
  userId: string;
  characterName: string | null;
}

interface Party {
  id: string;
  boss_id: string;
  label: string | null;
  sort_order: number;
  members: PartyMember[];
}

interface Member {
  id: string;
  name: string;
  role: string;
}

/** 넥슨에서 불러와 아직 파티에 안 들어간 "후보 캐릭터" (boss_candidates 한 행). */
interface Candidate {
  id: string;
  bossId: string;
  userId: string;
  characterName: string;
  memberName: string;
}

interface Props {
  projectId: string;
  bosses: Boss[];
  parties: Party[];
  nextParties: Party[]; // [추가] 0017: 다음주에 보일 파티 (다음주 따로인 보스는 다음주 전용 파티)
  members: Member[];
  candidates: Candidate[];
  memberChars: MemberChar[]; // [추가] 그룹원별 캐릭터 목록 (파티 추가·수정 폼용)
  canHideBoss: boolean; // [변경] 0019: 보스 숨기기(파티가 있으면 삭제 포함)는 운영자만 (부운영자는 파티 편집만)
  hiddenBosses: { name: string; difficulty: string }[]; // [추가] 0019: 이 그룹이 목록에서 숨긴 보스(난이도 없음 = "")
}

/** [추가] 그룹원 한 명의 캐릭터 하나 (settings/page.tsx에서 여러 데이터를 합쳐 만든다). */
interface MemberChar {
  userId: string;
  characterName: string;
}

// 보스/파티를 직접 CRUD하는 설정 화면. 원본의 하드코딩된 BOSS_ORDER +
// RAW_PARTIES + "예약된 변경사항" 메커니즘을 대신한다 -- 여기서 하는 모든
// 조작은 바로 실제 DB 행이라, 재배포나 예약 개념 자체가 필요 없다.
export default function BossRosterEditor({ projectId, bosses, parties, nextParties, members, candidates, memberChars, canHideBoss, hiddenBosses }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [newBossName, setNewBossName] = useState("");
  // [추가] 보스 드롭다운 선택값: "" = 미선택, 보스 이름, 또는 CUSTOM_BOSS
  const [newBossChoice, setNewBossChoice] = useState("");
  const [newBossDifficulty, setNewBossDifficulty] = useState<Difficulty | "">("");
  const [addingPartyFor, setAddingPartyFor] = useState<string | null>(null);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  // [추가] 펼친 보스(난이도) 줄 키 집합. 기본은 전부 닫힘 (화면 보기 편의라 로컬 state)
  const [opened, setOpened] = useState<Set<string>>(new Set());
  // [추가] 0017: 보스 목록을 이번주/다음주 중 어느 주로 보고 고치는지
  const [week, setWeek] = useState<"this" | "next">("this");
  const viewParties = week === "next" ? nextParties : parties;

  function refresh() {
    router.refresh();
  }

  // [추가] 0017: 다음주 탭에서 "이번주와 같음"인 보스를 처음 고칠 때, 이번주 파티를 복사해 다음주 전용 파티를 만든다.
  // 돌려받은 {이번주 파티 id: 다음주 파티 id}로 고치려던 파티를 새 id로 바꿔 잡는다.
  // 이번주 탭이거나 이미 다음주 따로인 보스면 아무것도 안 하고 빈 맵을 돌려준다.
  // 화면이 새로고침되기 전에 같은 보스를 또 고치면 옛 id(이번주 파티)를 건드리지 않도록, 받은 맵을 기억해 둔다.
  const madeNextRef = useRef<Map<string, Record<string, string>>>(new Map());
  async function ensureNext(bossId: string, alreadyCustom: boolean): Promise<Record<string, string>> {
    if (week !== "next") return {};
    const made = madeNextRef.current.get(bossId);
    if (made) return made;
    if (alreadyCustom) return {};
    const { data, error } = await supabase.rpc("make_next_roster", { p_boss_id: bossId });
    if (error) {
      alert(`다음주 파티를 만들지 못했어요: ${error.message}`);
      throw error;
    }
    const map = (data ?? {}) as Record<string, string>;
    madeNextRef.current.set(bossId, map);
    return map;
  }

  // [추가] 0017: 다음주 파티를 이번주와 같게 되돌린다 (다음주용으로 바꾼 구성과 그 파티의 미리확정이 지워짐)
  function resetNext(boss: Boss) {
    if (!confirm("다음주 파티를 이번주와 같게 되돌릴까요? 다음주용으로 바꾼 파티 구성과 그 파티들의 다음주 미리확정 시간이 지워져요.")) return;
    startTransition(async () => {
      await supabase.rpc("reset_next_roster", { p_boss_id: boss.id });
      madeNextRef.current.delete(boss.id); // 다시 고치면 새로 복사한다
      refresh();
    });
  }

  // [추가] 0017: 파티 수정 폼 열기. 다음주 탭에서 처음 고치는 보스면 다음주 전용 파티를 만든 뒤 그 복사본을 연다
  function startEdit(boss: Boss, p: Party) {
    setAddingPartyFor(null);
    if (week !== "next" || boss.next_custom || madeNextRef.current.has(boss.id)) {
      const map = madeNextRef.current.get(boss.id) ?? {};
      setEditingParty(week === "next" ? { ...p, id: map[p.id] ?? p.id } : p);
      return;
    }
    startTransition(async () => {
      const map = await ensureNext(boss.id, false);
      setEditingParty({ ...p, id: map[p.id] ?? p.id });
      refresh();
    });
  }

  // [추가] 드롭다운에서 보스를 고르면 이름·난이도를 함께 맞춘다 (주기는 저장할 때 이름으로 자동 결정)
  function chooseBoss(value: string) {
    setNewBossChoice(value);
    if (value === CUSTOM_BOSS || value === "") {
      setNewBossName("");
      setNewBossDifficulty("");
      return;
    }
    setNewBossName(value);
    const diffs = difficultiesOf(value);
    setNewBossDifficulty(diffs.length === 1 ? diffs[0] : ""); // 난이도가 하나뿐이면 자동 선택
  }

  // [추가] 난이도 드롭다운에 보일 목록: 목록의 보스면 그 보스 난이도만, 직접 입력이면 전체
  const difficultyOptions =
    newBossChoice && newBossChoice !== CUSTOM_BOSS ? difficultiesOf(newBossChoice) : DIFFICULTIES;

  // [추가] 보스(난이도) 줄 하나를 가리키는 키. 카탈로그 줄은 DB에 카드가 없어도 같은 키를 쓴다
  const rowKey = (name: string, difficulty: string | null) => `${name}|${difficulty ?? ""}`;

  function toggleRow(key: string) {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // [추가] 보스(난이도) 줄을 펼치고 그 줄의 파티 추가 폼을 연다. DB에 카드가 없으면 먼저 만든다
  // (그래서 DB에는 실제로 파티를 만드는 난이도만 생긴다). 주기는 이름으로 자동 결정 (검은 마법사만 월간).
  function openAddParty(name: string, difficulty: Difficulty | null, key = rowKey(name, difficulty)) {
    setOpened((prev) => new Set(prev).add(key));
    setEditingParty(null);
    // [추가] 0019: 숨긴 보스를 위쪽 "파티 추가" 폼으로 고르면 다시 보이게 한다
    if (hiddenSet.has(rowKey(name, difficulty))) {
      startTransition(async () => {
        await unhideBoss(name, difficulty ?? "");
        refresh();
      });
    }
    const existing = bosses.find((b) => b.name === name && (b.difficulty ?? null) === difficulty);
    if (existing) {
      // [변경] 0017: 다음주 탭에서 처음 고치는 보스면 다음주 전용 파티를 먼저 만든다
      if (week === "next" && !existing.next_custom) {
        startTransition(async () => {
          await ensureNext(existing.id, false);
          setAddingPartyFor(key);
          refresh();
        });
        return;
      }
      setAddingPartyFor(key);
      return;
    }
    const sortOrder = bosses.length ? Math.max(...bosses.map((b) => b.sort_order)) + 1 : 0;
    startTransition(async () => {
      const { data } = await supabase
        .from("bosses")
        .insert({
          project_id: projectId,
          name,
          period: isMonthlyBossName(name) ? "monthly" : "weekly",
          difficulty,
          sort_order: sortOrder,
        })
        .select("id")
        .single();
      if (data?.id && week === "next" && !isMonthlyBossName(name)) await ensureNext(data.id, false); // [추가] 0017: 다음주 탭에서 만든 보스는 다음주 전용으로
      if (data?.id) setAddingPartyFor(key);
      refresh();
    });
  }

  // [변경] 상단 폼 "파티 추가": 고른 보스·난이도 줄을 펼치고 파티 추가 폼을 연다 (직접 입력 보스도 여기서 만든다)
  function addParty(e: React.FormEvent) {
    e.preventDefault();
    if (!newBossName.trim()) return;
    // "세렌 H"처럼 이름에 난이도를 붙여 쳐도, 난이도를 따로 안 골랐으면 이름에서 떼어 난이도로 쓴다
    // (이름엔 깨끗한 보스 이름만 남겨서, 메소 계산용 MESO_TABLE 조회가 이름으로 정확히 맞게).
    const parsed = parseTrailingDifficulty(newBossName);
    const finalName = newBossDifficulty ? newBossName.trim() : parsed.name;
    const finalDifficulty = newBossDifficulty || parsed.difficulty || null;
    setNewBossName("");
    setNewBossDifficulty("");
    setNewBossChoice("");
    openAddParty(finalName, finalDifficulty);
  }

  // [추가] 그룹 관리 보스 목록 줄: 카탈로그 보스 × 난이도를 DB에 카드가 없어도 모두 깔고, 있는 카드를 맞춰 넣는다.
  // 카탈로그에 없는 보스/난이도 카드(직접 입력, 난이도 없음 등)는 따로 한 줄씩 붙인다. 순서는 compareBossOrder.
  const rows = useMemo(() => {
    type Row = { key: string; name: string; difficulty: Difficulty | null; boss: Boss | null; sort_order: number };
    const used = new Set<string>();
    const out: Row[] = [];
    for (const c of BOSS_CATALOG) {
      for (const d of difficultiesOf(c.name)) {
        const boss = bosses.find((b) => b.name === c.name && b.difficulty === d && !used.has(b.id)) ?? null;
        if (boss) used.add(boss.id);
        out.push({ key: rowKey(c.name, d), name: c.name, difficulty: d, boss, sort_order: boss?.sort_order ?? 0 });
      }
    }
    for (const b of bosses) {
      if (used.has(b.id)) continue;
      const k = rowKey(b.name, b.difficulty);
      out.push({
        key: out.some((r) => r.key === k) ? `id:${b.id}` : k, // 같은 보스·난이도 카드가 두 개면 뒤엣것은 id로 구분
        name: b.name,
        difficulty: b.difficulty,
        boss: b,
        sort_order: b.sort_order,
      });
    }
    return out.sort(compareBossOrder);
  }, [bosses]);
  // [추가] 0017: 다음주 탭에서는 월간 보스(검은 마법사)를 숨긴다 -- 월간은 주 구분 없이 이번주 탭에서 관리
  // [추가] 0019: 숨긴 보스(이름+난이도)는 목록에서 뺀다
  const hiddenSet = useMemo(
    () => new Set(hiddenBosses.map((h) => rowKey(h.name, (h.difficulty || null) as Difficulty | null))),
    [hiddenBosses]
  );
  const visibleRows = rows
    .filter((r) => !hiddenSet.has(rowKey(r.name, r.difficulty)))
    .filter((r) => week !== "next" || (r.boss?.period ?? (isMonthlyBossName(r.name) ? "monthly" : "weekly")) !== "monthly");

  // [추가] 파티 추가 폼이 열린 줄로 스크롤 (새로 만든 카드는 새로고침 뒤에 생기므로 bosses도 지켜본다)
  useEffect(() => {
    if (!addingPartyFor) return;
    document.getElementById(`boss-row-${addingPartyFor}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [addingPartyFor, bosses]);

  // [변경] 0019: "보스 삭제"를 "숨기기"로 합쳤다. 보스 카드가 있으면 카드를 지우고(이번주·다음주 파티·확정도 함께 지워짐),
  // 이름+난이도를 hidden_bosses에 넣어 목록에서 뺀다. 파티가 있을 때만 확인 창을 띄운다.
  function hideBoss(row: { name: string; difficulty: Difficulty | null; boss: Boss | null }) {
    const bossId = row.boss?.id;
    const hasParties = !!bossId && [...parties, ...nextParties].some((p) => p.boss_id === bossId);
    if (hasParties && !confirm("숨기면 이 보스의 이번주·다음주 파티와 확정 시간이 모두 지워져요. 숨길까요?")) return;
    startTransition(async () => {
      if (bossId) {
        const { error } = await supabase.from("bosses").delete().eq("id", bossId);
        if (error) {
          alert(`보스를 지우지 못했어요: ${error.message}`);
          return;
        }
      }
      await supabase
        .from("hidden_bosses")
        .upsert(
          { project_id: projectId, name: row.name, difficulty: row.difficulty ?? "" },
          { onConflict: "project_id,name,difficulty", ignoreDuplicates: true }
        );
      refresh();
    });
  }

  // [추가] 0019: 숨긴 보스를 다시 목록에 보이게 한다 (지워진 파티는 돌아오지 않음)
  async function unhideBoss(name: string, difficulty: string) {
    await supabase.from("hidden_bosses").delete().match({ project_id: projectId, name, difficulty });
  }

  function deleteParty(boss: Boss, id: string) {
    startTransition(async () => {
      const map = await ensureNext(boss.id, !!boss.next_custom); // [추가] 0017: 다음주 탭이면 다음주 전용 복사본에서 지운다
      await supabase.from("parties").delete().eq("id", map[id] ?? id);
      refresh();
    });
  }

  // 파티원을 빼서 다시 후보 풀로 되돌린다 (best-effort: 캐릭터명이 없는
  // 수동 추가 멤버는 후보로 되돌릴 캐릭터명이 없어서 그냥 제거만 한다).
  function unassignToCandidate(boss: Boss, party: Party, member: PartyMember) {
    startTransition(async () => {
      const map = await ensureNext(boss.id, !!boss.next_custom); // [추가] 0017: 다음주 탭이면 다음주 전용 복사본에서 뺀다
      await supabase.from("party_members").delete().eq("party_id", map[party.id] ?? party.id).eq("user_id", member.userId);
      if (member.characterName) {
        await supabase.from("boss_candidates").upsert(
          { project_id: projectId, boss_id: boss.id, user_id: member.userId, character_name: member.characterName },
          { onConflict: "boss_id,user_id,character_name", ignoreDuplicates: true }
        );
      }
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={addParty} className="card flex flex-wrap items-end gap-2">
        {/* [변경] 보스 드롭다운이 가로를 다 차지해 꺽쇠가 멀어 보이지 않게 폭 제한 */}
        <div className="flex flex-1 flex-col gap-1 max-w-xs">
          <label className="label">보스</label>
          {/* [추가] 보스는 목록에서 고르고, 목록에 없으면 "직접 입력…"으로 입력칸을 연다 */}
          <select value={newBossChoice} onChange={(e) => chooseBoss(e.target.value)} className="input">
            <option value="">보스 선택</option>
            {BOSS_CATALOG.map((b) => (
              <option key={b.name} value={b.name}>
                {displayBossName(b.name)} {/* [변경] 보이는 글자만 풀네임, 저장 값은 짧은 이름 */}
              </option>
            ))}
            <option value={CUSTOM_BOSS}>직접 입력…</option>
          </select>
          {newBossChoice === CUSTOM_BOSS && (
            <input
              value={newBossName}
              onChange={(e) => setNewBossName(e.target.value)}
              placeholder="보스 이름 (예: 세렌 — 난이도는 오른쪽에서 따로 선택)"
              className="input"
              autoFocus
            />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">난이도 (메소 계산용, 선택)</label>
          {/* [변경] 난이도는 어디서든 배지로 보여야 해서 드롭다운 대신 배지 버튼으로 고른다.
              고른 보스에 실제로 있는 난이도만 나오고, 고른 것을 다시 누르면 "없음"이 된다 */}
          <div className="flex min-h-[42px] flex-wrap items-center gap-1.5">
            {difficultyOptions.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setNewBossDifficulty(newBossDifficulty === d ? "" : d)}
                aria-pressed={newBossDifficulty === d}
                className={
                  "rounded-md p-0.5 transition " +
                  (newBossDifficulty === d ? "ring-2 ring-orange-400" : "opacity-50 hover:opacity-100")
                }
              >
                <DifficultyBadge difficulty={d} />
              </button>
            ))}
            {!newBossDifficulty && <span className="text-xs text-slate-400">없음</span>}
          </div>
        </div>
        {/* [변경] 보스 추가 버튼을 폼 오른쪽 끝으로 붙인다 (ml-auto: 남는 왼쪽 여백을 모두 차지) */}
        <button type="submit" disabled={isPending || !newBossName.trim()} className="btn-primary ml-auto">
          파티 추가 {/* [변경] "보스 추가" -> "파티 추가" (보스 카드는 자동 생성) */}
        </button>
      </form>

      {/* [변경] 보스 목록: 하나의 카드 안에 카탈로그 보스(난이도) 줄을 모두 깔아 둔다 (스케줄 화면 보스 목록과 같은 모양).
          줄을 펼치면 확정된 파티와 "+ 파티 추가"가 나온다. 순서는 compareBossOrder */}
      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">🗓️ 보스 목록</h2>
          {/* [추가] 0017: 이번주 / 다음주 파티 구성 토글 */}
          <div className="inline-flex rounded-xl border border-slate-200/60 bg-slate-100 p-1">
            {(
              [
                ["this", "이번주"],
                ["next", "다음주"],
              ] as ["this" | "next", string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setWeek(v);
                  setEditingParty(null);
                  setAddingPartyFor(null);
                }}
                className={
                  "rounded-lg px-3 py-1 text-xs font-bold transition " +
                  (week === v ? "bg-white text-orange-600 shadow-sm" : "text-slate-500 hover:text-slate-800")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {week === "next" && (
          <p className="sub">
            다음주 파티는 이번주 파티를 그대로 따라가요. 여기서 고친 보스만 다음주용으로 따로 저장되고, 목요일 0시에 이번주
            파티가 돼요. 검은 마법사(월간)는 주 구분이 없어서 이번주 탭에서 관리해요.
          </p>
        )}
        {visibleRows.map((row) => {
          const boss = row.boss;
          const bossParties = boss
            ? viewParties.filter((p) => p.boss_id === boss.id).sort((a, b) => a.sort_order - b.sort_order) // [변경] 0017: 고르는 주의 파티
            : [];
          const bossCandidates = boss ? candidates.filter((c) => c.bossId === boss.id) : [];
          const isOpen = opened.has(row.key);
          return (
            <section key={row.key} id={`boss-row-${row.key}`} className={"boss-group" + (isOpen ? " open" : "")}>
              {/* [변경] 0018: 헤더 줄 = 펼치기 버튼 + 오른쪽 "보스 삭제" (버튼 안에 버튼을 넣을 수 없어 나란히 둔다) */}
              <div className="boss-group-headrow">
              <button type="button" className="boss-group-head" onClick={() => toggleRow(row.key)} aria-expanded={isOpen}>
                <span className="boss-group-title">
                  {displayBossName(row.name)} {/* 화면에는 넥슨 풀네임으로 */}
                  <DifficultyBadge difficulty={row.difficulty} />
                </span>
                <span className="boss-group-summary">
                  {/* [추가] 0017: 다음주 탭에서는 이번주와 같은지/따로인지 표시 */}
                  {week === "next" && boss && (
                    <span className={"mr-2 text-[11px] font-bold " + (boss.next_custom ? "text-sky-600" : "text-slate-400")}>
                      {boss.next_custom ? "다음주 따로" : "이번주와 같음"}
                    </span>
                  )}
                  파티 {bossParties.length}
                </span>
                <span className="boss-group-chevron" aria-hidden="true">
                  ▸
                </span>
              </button>
              {/* [변경] 0019: 펼치지 않아도 바로 보이는 "숨기기" (보스 삭제를 합침, 모든 줄, 이번주·다음주 탭 모두, 운영자만) */}
              {canHideBoss && (
                <button type="button" disabled={isPending} onClick={() => hideBoss(row)} className="boss-group-del">
                  숨기기
                </button>
              )}
              </div>
              <div className="boss-group-body" hidden={!isOpen}>
                {bossParties.map((p, i) => (
                  <Fragment key={p.id}>
                    {/* 파티 줄: [파티 이름] | 참여자 칩(×로 빼기) ...... 수정 삭제 */}
                    <div className="party-row">
                      <span className="party-name">{p.label || `${i + 1}파티`}</span>
                      <div className="party-members">
                        {p.members.length === 0 && <span className="text-muted text-xs">멤버 없음</span>}
                        {p.members.map((m) => {
                          const name = members.find((mm) => mm.id === m.userId)?.name ?? "?";
                          return (
                            <span key={m.userId} className="chip">
                              {name}
                              {m.characterName && <span className="chip-sub">· {m.characterName}</span>}
                              <button
                                type="button"
                                onClick={() => unassignToCandidate(boss!, p, m)}
                                title="파티에서 빼서 후보로 되돌리기"
                                aria-label={`${name} 파티에서 빼기`}
                                className="chip-x"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <div className="party-status text-xs">
                        <button disabled={isPending} onClick={() => startEdit(boss!, p)} className="underline">
                          수정
                        </button>
                        <button disabled={isPending} onClick={() => deleteParty(boss!, p.id)} className="text-red-500 underline">
                          삭제
                        </button>
                      </div>
                    </div>
                    {/* [변경] 파티 수정 폼은 페이지 맨 아래가 아니라 그 파티 바로 아래에 연다 */}
                    {editingParty?.id === p.id && boss && (
                      <div className="px-3.5 pb-3">
                        <PartyEditorForm
                          projectId={projectId}
                          boss={boss}
                          party={editingParty}
                          members={members}
                          memberChars={memberChars}
                          candidates={bossCandidates}
                          siblingParties={bossParties.filter((x) => x.id !== editingParty.id)}
                          sortOrder={editingParty.sort_order}
                          week={week} // [추가] 0017
                          onDone={() => {
                            setEditingParty(null);
                            refresh();
                          }}
                          onCancel={() => setEditingParty(null)}
                        />
                      </div>
                    )}
                  </Fragment>
                ))}
                {boss && addingPartyFor === row.key ? (
                  <div className="px-3.5 py-3">
                    <PartyEditorForm
                      projectId={projectId}
                      boss={boss}
                      members={members}
                      memberChars={memberChars}
                      candidates={bossCandidates}
                      siblingParties={bossParties}
                      sortOrder={bossParties.length}
                      week={week} // [추가] 0017
                      onDone={() => {
                        setAddingPartyFor(null);
                        refresh();
                      }}
                      onCancel={() => setAddingPartyFor(null)}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                    <button
                      disabled={isPending}
                      onClick={() => openAddParty(row.name, row.difficulty, row.key)}
                      className="btn-secondary !py-1 text-xs"
                    >
                      + 파티 추가
                    </button>
                    {/* [변경] 삭제는 DB에 카드가 있는 줄에만. 카탈로그 보스는 지워도 목록에 "파티 0"으로 남는다 */}
                    {/* [변경] 0018: 보스 삭제는 줄 헤더 쪽으로 옮김. 다음주 탭에는 "이번주와 같게 되돌리기" */}
                    {boss && week === "next" && boss.next_custom && (
                      <button disabled={isPending} onClick={() => resetNext(boss)} className="text-xs text-slate-500 underline">
                        이번주와 같게 되돌리기
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
        {/* [추가] 0019: 숨긴 보스 목록 -- "다시 보이기"로 꺼낸다 (운영자만) */}
        {canHideBoss && hiddenBosses.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500">숨긴 보스 {hiddenBosses.length}개 보기</summary>
            <div className="flex flex-wrap gap-2 pt-2">
              {[...hiddenBosses]
                .sort((a, b) =>
                  compareBossOrder(
                    { name: a.name, difficulty: (a.difficulty || null) as Difficulty | null, sort_order: 0 },
                    { name: b.name, difficulty: (b.difficulty || null) as Difficulty | null, sort_order: 0 }
                  )
                )
                .map((h) => (
                  <span key={`${h.name}|${h.difficulty}`} className="chip">
                    {displayBossName(h.name)}
                    <DifficultyBadge difficulty={(h.difficulty || null) as Difficulty | null} />
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          await unhideBoss(h.name, h.difficulty);
                          refresh();
                        })
                      }
                      className="text-xs text-slate-500 underline"
                    >
                      다시 보이기
                    </button>
                  </span>
                ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}

// [변경] 파티 추가·수정 폼: 그룹원마다 캐릭터 칩을 보여주고, 보스 최대 인원 안에서 캐릭터를 골라 파티를 만든다.
// - 한 사람은 한 파티에 캐릭터 하나만 (같은 사람의 다른 캐릭터를 누르면 그쪽으로 바뀜, party_members PK와 같음)
// - 인원이 최대(partyMaxOf)에 차면 아직 안 고른 사람의 칩은 고를 수 없다
// - 이 보스의 후보 캐릭터는 "후보" 표시 + 앞쪽, 같은 보스의 다른 파티에 있는 캐릭터는 "다른 파티"로 막는다
// - 목록에 없는 캐릭터는 사람별 "+ 직접 입력"으로 추가
// - 저장하면 파티원이 캐릭터 이름과 함께 들어가고, 고른 캐릭터는 이 보스의 후보 목록에서 빠진다(드래그 배정과 같음)
function PartyEditorForm({
  projectId,
  boss,
  party,
  members,
  memberChars,
  candidates,
  siblingParties,
  sortOrder,
  week,
  onDone,
  onCancel,
}: {
  projectId: string;
  boss: Boss;
  party?: Party;
  members: Member[];
  memberChars: MemberChar[];
  candidates: Candidate[]; // 이 보스의 후보 캐릭터
  siblingParties: Party[]; // 같은 보스의 다른 파티 (수정 중인 파티 자신은 제외)
  sortOrder: number;
  week: "this" | "next"; // [추가] 0017: 새 파티를 어느 주 파티로 만들지
  onDone: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const max = partyMaxOf(boss.name);
  const [label, setLabel] = useState(party?.label ?? "");
  // 사람별로 고른 캐릭터: userId -> 캐릭터 이름 ("" = 예전에 캐릭터 없이 들어가 있던 멤버)
  const [picked, setPicked] = useState<Map<string, string>>(
    () => new Map((party?.members ?? []).map((m) => [m.userId, m.characterName ?? ""]))
  );
  const [typingFor, setTypingFor] = useState<string | null>(null); // 직접 입력 칸이 열린 사람
  const [typedName, setTypedName] = useState("");
  const [typedChars, setTypedChars] = useState<MemberChar[]>([]); // 직접 입력으로 추가한 칩
  const [isPending, startTransition] = useTransition();

  const candidateKeys = new Set(candidates.map((c) => `${c.userId}|${c.characterName}`));
  const usedElsewhere = new Set(
    siblingParties.flatMap((p) => p.members.filter((m) => m.characterName).map((m) => `${m.userId}|${m.characterName}`))
  );

  /** 한 사람의 캐릭터 칩 목록: 이 보스의 후보 -> 나머지(가나다순), 지금 고른 캐릭터와 직접 입력한 캐릭터도 포함 */
  function charsOf(uid: string): string[] {
    const set = new Set<string>();
    for (const c of memberChars) if (c.userId === uid) set.add(c.characterName);
    for (const c of typedChars) if (c.userId === uid) set.add(c.characterName);
    const cur = picked.get(uid);
    if (cur) set.add(cur);
    return [...set].sort((a, b) => {
      const ca = candidateKeys.has(`${uid}|${a}`) ? 0 : 1;
      const cb = candidateKeys.has(`${uid}|${b}`) ? 0 : 1;
      return ca - cb || a.localeCompare(b, "ko");
    });
  }

  function pick(uid: string, ch: string) {
    const next = new Map(picked);
    if (next.get(uid) === ch) next.delete(uid); // 다시 누르면 해제
    else {
      if (!next.has(uid) && next.size >= max) return; // 인원이 찼으면 새 사람은 못 넣는다
      next.set(uid, ch);
    }
    setPicked(next);
  }

  function addTyped(uid: string) {
    const name = typedName.trim();
    setTypingFor(null);
    setTypedName("");
    if (!name) return;
    setTypedChars((prev) => (prev.some((c) => c.userId === uid && c.characterName === name) ? prev : [...prev, { userId: uid, characterName: name }]));
    if (picked.has(uid) || picked.size < max) setPicked(new Map(picked).set(uid, name));
  }

  function save() {
    startTransition(async () => {
      let partyId = party?.id;
      if (partyId) {
        await supabase.from("parties").update({ label: label.trim() || null }).eq("id", partyId);
        await supabase.from("party_members").delete().eq("party_id", partyId);
      } else {
        const { data } = await supabase
          .from("parties")
          .insert({ project_id: projectId, boss_id: boss.id, label: label.trim() || null, sort_order: sortOrder, week }) // [변경] 0017: 주 구분
          .select("id")
          .single();
        partyId = data?.id;
      }
      if (partyId && picked.size > 0) {
        await supabase.from("party_members").insert(
          [...picked.entries()].map(([uid, ch]) => ({ party_id: partyId!, user_id: uid, character_name: ch || null }))
        );
        // 고른 캐릭터가 이 보스의 후보였다면 후보 목록에서 뺀다
        const usedCandidateIds = candidates
          .filter((c) => picked.get(c.userId) === c.characterName)
          .map((c) => c.id);
        if (usedCandidateIds.length) await supabase.from("boss_candidates").delete().in("id", usedCandidateIds);
      }
      onDone();
    });
  }

  const full = picked.size >= max;

  return (
    <div className="flex flex-col gap-3 rounded-lg p-3" style={{ border: "1.5px dashed var(--border)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="파티 이름 (선택, 예: 1파티)"
          className="input min-w-[160px] flex-1"
        />
        <span className={"text-sm font-bold " + (full ? "text-orange-600" : "text-slate-500")}>
          인원 {picked.size} / {max}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {members.map((m) => {
          const chars = charsOf(m.id);
          const mine = picked.get(m.id);
          const locked = full && !picked.has(m.id); // 인원이 차서 이 사람은 못 넣음
          return (
            <div key={m.id} className={"flex flex-wrap items-center gap-1.5 " + (locked ? "opacity-50" : "")}>
              <span className="w-20 shrink-0 text-sm font-semibold text-slate-700">{m.name}</span>
              {chars.length === 0 && <span className="text-xs text-slate-400">캐릭터 없음</span>}
              {chars.map((ch) => {
                const key = `${m.id}|${ch}`;
                const sel = mine === ch;
                const taken = usedElsewhere.has(key) && !sel;
                const isCandidate = candidateKeys.has(key);
                return (
                  <button
                    key={ch}
                    type="button"
                    disabled={isPending || taken || (locked && !sel)}
                    onClick={() => pick(m.id, ch)}
                    aria-pressed={sel}
                    className={
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition disabled:cursor-not-allowed " +
                      (sel
                        ? "border-orange-400 bg-orange-50 text-orange-600"
                        : taken
                        ? "border-slate-200 bg-slate-50 text-slate-300"
                        : "border-slate-200 bg-white text-slate-600 hover:border-orange-300")
                    }
                  >
                    {sel && "✓ "}
                    {ch}
                    {isCandidate && !taken && <span className="text-[10px] text-sky-600">후보</span>}
                    {taken && <span className="text-[10px]">· 다른 파티</span>}
                  </button>
                );
              })}
              {mine === "" && (
                <span className="text-xs text-slate-400">(캐릭터 미지정으로 들어가 있음 — 캐릭터를 골라 주세요)</span>
              )}
              {typingFor === m.id ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    autoFocus
                    value={typedName}
                    maxLength={20}
                    onChange={(e) => setTypedName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addTyped(m.id);
                      if (e.key === "Escape") setTypingFor(null);
                    }}
                    placeholder="캐릭터 이름"
                    className="!w-32 !py-0.5 text-xs"
                  />
                  <button type="button" onClick={() => addTyped(m.id)} className="text-xs underline">
                    추가
                  </button>
                </span>
              ) : (
                !locked && (
                  <button
                    type="button"
                    onClick={() => {
                      setTypingFor(m.id);
                      setTypedName("");
                    }}
                    className="text-xs text-slate-500 underline"
                  >
                    + 직접 입력
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <button disabled={isPending} onClick={save} className="btn-primary !px-3 !py-1 text-xs">
          저장
        </button>
        <button onClick={onCancel} className="btn-secondary !px-3 !py-1 text-xs">
          취소
        </button>
      </div>
    </div>
  );
}
