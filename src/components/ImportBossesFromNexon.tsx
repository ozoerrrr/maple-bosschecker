"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { displayBossName, normalizeNexonDifficulty } from "@/lib/scheduling/meso";
import DifficultyBadge from "@/components/DifficultyBadge";
import type { RawBoss, RawParty } from "@/lib/scheduling/snapshot";
import type { SoloPlanRow } from "@/lib/scheduling/solo";
import { markSynced, syncFromScheduler, type SchedulerCharacterResult } from "@/lib/nexon/syncScheduler";
import { markLocalChange } from "@/components/LiveRefreshButton";
import type { ConfirmationMap } from "@/lib/scheduling/types";

interface FetchedBoss {
  name: string;
  difficulty: string;
  cycle: string;
  complete: boolean;
  characterName: string;
}

/** 이미 후보 풀(boss_candidates)에 등록돼 있는 (보스이름, 난이도, 캐릭터이름). */
interface ExistingCandidate {
  name: string;
  difficulty: string | null;
  characterName: string;
}

interface Props {
  projectId: string;
  existingCandidates: ExistingCandidate[];
  /** 프로필에 연동해둔 내 본캐 닉네임. 캐릭터 입력칸의 기본값으로 쓴다. */
  myCharacterName?: string | null;
  savedCharacterNames?: string[]; // [추가] 이미 저장된 내 캐릭터 이름(초기 목록용)
  currentUserId: string;
  bosses: RawBoss[]; // [추가] 그룹 보스 명단 (후보는 이미 있는 보스에만 등록, 파티 보스 판별)
  parties: RawParty[]; // [추가] 메소 카드 자동 채우기에서 파티 보스를 먼저 빼기 위해
  soloPlans: SoloPlanRow[]; // [추가] 기존 솔로 계획의 공팟 인원 유지용
  confirmed: ConfirmationMap; // [추가] 이번주 파티 확정 (인게임 완료로 파티 클리어 반영할 때 기존 확정 유지)
}

// [고침] "이미 있음"은 "이 보스/난이도가 그룹 명단에 이미 있다"가 아니라
// "이 캐릭터가 이 보스/난이도에 이미 후보로 등록돼 있다"는 뜻이어야 한다.
// 전자로 체크하면, 다른 멤버가 이미 같은 보스를 등록해놔서 보스 자체는
// 명단에 있지만 "나"는 아직 후보로 안 올린 캐릭터에도 "이미 있음"이 잘못
// 붙어서 혼란스러웠다.
function isAlreadyAdded(existingCandidates: ExistingCandidate[], b: FetchedBoss): boolean {
  const normalized = normalizeNexonDifficulty(b.difficulty);
  return existingCandidates.some(
    (c) => c.name === b.name && normalizeNexonDifficulty(c.difficulty) === normalized && c.characterName === b.characterName
  );
}

export default function ImportBossesFromNexon({
  projectId,
  existingCandidates,
  myCharacterName,
  currentUserId,
  savedCharacterNames,
  bosses: groupBosses,
  parties,
  soloPlans,
  confirmed,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // [추가] 본캐 + 저장된 내 캐릭터로 시작한다 (본캐가 맨 앞, 중복 제거).
  // 화면 안에서만 들고 있던 목록이라 페이지를 옮기면 본캐만 남던 문제를 막는다.
  const [characterNames, setCharacterNames] = useState<string[]>(() => [
    ...new Set([...(myCharacterName ? [myCharacterName] : []), ...(savedCharacterNames ?? [])]),
  ]);
  const [nameInput, setNameInput] = useState("");
  const [fetched, setFetched] = useState(false);
  const [charErrors, setCharErrors] = useState<{ characterName: string; error: string }[]>([]);
  const [bosses, setBosses] = useState<FetchedBoss[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // [추가] 메소 카드 자동 채우기 결과 한 줄 요약 (캐릭터별)
  const [soloSummary, setSoloSummary] = useState<string[]>([]);

  // [추가] 그룹에 이미 있는 보스(이름·난이도)인지. 불러오기는 그룹 보스 목록을 바꾸지 않으므로
  // 그룹에 없는 보스는 후보로 등록할 수 없다 (보스 일정은 그룹장만 바꾼다, 0014).
  function groupBossId(b: { name: string; difficulty: string }): string | null {
    const d = normalizeNexonDifficulty(b.difficulty);
    return groupBosses.find((g) => g.name === b.name && (g.difficulty ?? null) === d)?.id ?? null;
  }

  function bossKey(b: FetchedBoss) {
    return `${b.characterName}__${b.name}__${b.difficulty}`;
  }

  function addCharacterName() {
    const name = nameInput.trim();
    if (!name) return;
    if (!characterNames.includes(name)) setCharacterNames([...characterNames, name]);
    setNameInput("");
  }

  function removeCharacterName(name: string) {
    setCharacterNames(characterNames.filter((n) => n !== name));
  }

  async function handleFetch() {
    if (characterNames.length === 0) {
      setError("조회할 캐릭터명을 1개 이상 입력해주세요.");
      return;
    }
    setOpen(true);
    setLoading(true);
    setError(null);
    setFetched(false);
    // [변경] 조회·내 캐릭터 저장·솔로 계획 덮어쓰기·인게임 클리어 반영은 공통 함수(syncFromScheduler)가 한다.
    // 스케줄 페이지 진입 시 자동 동기화, 메소 카드의 "새로고침"도 같은 함수를 쓴다.
    markLocalChange(30000); // [추가] 내 저장으로 생기는 변경은 레드닷을 켜지 않게
    const sync = await syncFromScheduler(characterNames, {
      supabase,
      projectId,
      userId: currentUserId,
      bosses: groupBosses,
      parties,
      soloPlans,
      confirmed,
    });
    setLoading(false);
    if (sync.error) {
      setError(sync.error);
      return;
    }
    markSynced(projectId, currentUserId); // 방금 동기화했으니 10분 동안은 자동 동기화를 건너뛴다
    setFetched(true);
    const results: SchedulerCharacterResult[] = sync.results;
    setCharErrors(sync.charErrors);
    setSoloSummary(sync.summary);
    router.refresh(); // 저장한 부캐·솔로 계획·클리어가 메소 카드에 바로 나오게

    const allBosses: FetchedBoss[] = results.flatMap((r) =>
      r.error ? [] : r.bosses.map((b) => ({ ...b, characterName: r.character_name }))
    );
    setBosses(allBosses);

    // 이미 후보로 있거나 그룹에 없는 보스는 기본 선택 해제.
    const initial = new Set<string>();
    for (const b of allBosses) {
      if (isAlreadyAdded(existingCandidates, b) || !groupBossId(b)) continue; // [변경] 그룹에 없는 보스는 후보 불가
      initial.add(bossKey(b));
    }
    setSelected(initial);
  }

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  }

  // 선택된 후보들을 (보스 이름, 난이도)로 묶어서 보여주기 위한 그룹핑.
  type BossGroup = { name: string; difficulty: string; chars: FetchedBoss[] };
  const groups: BossGroup[] = [];
  {
    const byKey = new Map<string, BossGroup>();
    for (const b of bosses) {
      const key = `${b.name}__${normalizeNexonDifficulty(b.difficulty) ?? ""}`;
      let g = byKey.get(key);
      if (!g) {
        g = { name: b.name, difficulty: b.difficulty, chars: [] };
        byKey.set(key, g);
        groups.push(g);
      }
      g.chars.push(b);
    }
  }

  async function handleAdd() {
    const toAdd = bosses.filter((b) => selected.has(bossKey(b)));
    if (toAdd.length === 0) {
      setOpen(false);
      return;
    }
    setSaving(true);

    // [변경] 불러오기는 그룹 보스 목록을 바꾸지 않는다 (보스 일정은 그룹장만, 0014).
    // 그룹에 이미 있는 보스(이름·난이도)에만 내 캐릭터를 후보(boss_candidates)로 넣는다.
    // party_members에는 넣지 않는다 -- 그룹장이 파티 폼에서 "후보" 표시를 보고 골라 넣는다.
    const candidateRows = toAdd.flatMap((b) => {
      const bossId = groupBossId(b);
      return bossId ? [{ project_id: projectId, boss_id: bossId, user_id: currentUserId, character_name: b.characterName }] : [];
    });

    if (candidateRows.length > 0) {
      // 같은 캐릭터를 같은 보스에 중복으로 불러와도 (boss_id,user_id,character_name)
      // unique 제약 덕에 upsert가 조용히 no-op 처리된다.
      const { error: candErr } = await supabase
        .from("boss_candidates")
        .upsert(candidateRows, { onConflict: "boss_id,user_id,character_name", ignoreDuplicates: true });
      if (candErr) {
        setSaving(false);
        setError(candErr.message);
        return;
      }
    }

    setSaving(false);
    setOpen(false);
    markLocalChange(); // [추가]
    router.refresh();
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">넥슨 스케줄러에서 보스 불러오기</h2>
          <p className="label help-detail"> {/* [변경] 긴 안내는 도움말을 켰을 때만 */}
            넥슨 스케줄러 등록 정보는 비공개라서, <b>프로필에 연동해둔 내 넥슨 API 키로 내 캐릭터(본캐+부캐)만</b>{" "}
            불러올 수 있어요 — 다른 사람 캐릭터는 그 사람이 직접 연동해서 불러와야 해요. 불러오면 인게임 스케줄러대로
            "캐릭터별 메소 · 솔로 보스"의 이번주 솔로 계획이 채워지고(파티 보스는 제외, 이후 직접 수정 가능), 그룹에 있는
            보스는 후보로 추가할 수 있어요.
          </p>
        </div>
        {!open && (
          <button onClick={() => setOpen(true)} className="btn-secondary whitespace-nowrap">
            불러오기
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1.5">
            <p className="label">조회할 캐릭터 (내 넥슨 계정의 본캐+부캐만 가능)</p>
            <div className="flex flex-wrap gap-2">
              {characterNames.map((name) => (
                <span key={name} className="chip">
                  {name}
                  <button
                    type="button"
                    onClick={() => removeCharacterName(name)}
                    aria-label={`${name} 제거`}
                    className="text-muted"
                    style={{ marginLeft: 2 }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {characterNames.length === 0 && <span className="text-muted text-xs">등록된 캐릭터가 없어요.</span>}
            </div>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="캐릭터 닉네임 추가 (예: 부캐이름)"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCharacterName();
                  }
                }}
              />
              <button type="button" onClick={addCharacterName} className="btn-secondary !px-3 !py-1 text-xs whitespace-nowrap">
                추가
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button disabled={loading} onClick={handleFetch} className="btn-primary !px-3 !py-1 text-xs">
              {loading ? "불러오는 중..." : "불러오기"}
            </button>
            <button onClick={() => setOpen(false)} className="btn-secondary !px-3 !py-1 text-xs">
              닫기
            </button>
          </div>

          {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}

          {fetched && !loading && (
            <>
              {charErrors.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {charErrors.map((c) => (
                    <p key={c.characterName} className="text-xs" style={{ color: "var(--warn)" }}>
                      {c.characterName}: {c.error}
                    </p>
                  ))}
                </div>
              )}
              {/* [추가] 메소 카드 자동 채우기 결과 */}
              {soloSummary.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <p className="label">메소 카드 반영 (이번주 솔로 계획·클리어를 인게임 스케줄러로 덮어씀)</p>
                  {soloSummary.map((s) => (
                    <p key={s} className="text-xs text-slate-600">
                      {s}
                    </p>
                  ))}
                </div>
              )}
              {bosses.length === 0 && (
                <p className="text-muted">
                  등록된 보스가 없어요. 게임 내에서 먼저 스케줄러에 보스를 등록해주세요.
                </p>
              )}

              <div className="flex flex-col gap-2">
                {groups.map((g) => (
                  <div key={`${g.name}__${g.difficulty}`} className="flex flex-col gap-1">
                    <p className="label">
                      {displayBossName(g.name)} {/* [변경] 화면에는 넥슨 풀네임으로 */}
                      {/* [변경] 넥슨이 주는 영문 난이도 대신 난이도 배지 */}
                      <DifficultyBadge difficulty={normalizeNexonDifficulty(g.difficulty)} className="ml-1.5" />
                      {/* [추가] 그룹에 없는 보스는 후보로 넣을 수 없다 (그룹장이 그룹 관리에서 파티를 만들어야 생김) */}
                      {!groupBossId(g) && <span className="ml-1.5 text-slate-400">· 그룹에 없는 보스</span>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {g.chars.map((b) => {
                        const key = bossKey(b);
                        const already = isAlreadyAdded(existingCandidates, b);
                        const inGroup = !!groupBossId(b);
                        return (
                          <label
                            key={key}
                            className={"pill " + (selected.has(key) ? "active" : "") + (inGroup ? "" : " opacity-50 cursor-default")}
                          >
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={selected.has(key)}
                              disabled={!inGroup}
                              onChange={() => toggle(key)}
                            />
                            {b.characterName}
                            {already && " (이미 있음)"}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {bosses.length > 0 && (
                <div className="flex gap-2">
                  <button disabled={saving} onClick={handleAdd} className="btn-primary !px-3 !py-1 text-xs">
                    {saving ? "추가하는 중..." : "후보로 추가"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
