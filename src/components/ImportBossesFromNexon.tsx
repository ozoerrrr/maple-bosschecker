"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeNexonDifficulty } from "@/lib/scheduling/meso";
import DifficultyBadge from "@/components/DifficultyBadge";
import type { Difficulty } from "@/lib/scheduling/types";

interface FetchedBoss {
  name: string;
  difficulty: string;
  cycle: string;
  complete: boolean;
  characterName: string;
}

interface CharacterResult {
  character_name: string;
  world_name: string | null;
  bosses: Omit<FetchedBoss, "characterName">[];
  error?: string;
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
}

// "검은 마법사"만 월간, 나머지는 전부 주간 -- 지금 기준 메이플 보스 중
// 실제로 월 단위로 리셋되는 건 검은 마법사뿐이라 하드코딩. 넥슨 cycle
// 필드 값이 애매하면("월" 포함 여부로 1차 추정) 이걸로 덮어쓴다.
const MONTHLY_BOSS_NAMES = ["검은 마법사"];

function guessPeriod(name: string, cycle: string): "weekly" | "monthly" {
  if (MONTHLY_BOSS_NAMES.some((m) => name.includes(m))) return "monthly";
  if (cycle?.includes("월")) return "monthly";
  return "weekly";
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
    const res = await fetch(`/api/nexon/boss-schedule?names=${encodeURIComponent(characterNames.join(","))}`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "불러오기에 실패했어요.");
      return;
    }
    setFetched(true);

    const results: CharacterResult[] = data.results ?? [];
    const failed = results.filter((r) => r.error).map((r) => ({ characterName: r.character_name, error: r.error! }));
    setCharErrors(failed);

    // [추가] 조회에 성공한 캐릭터를 내 캐릭터 목록(extra_characters)에 저장한다.
    // 이미 있으면 무시한다. 보스를 하나도 등록하지 않은 부캐도 다음에 다시 보이게 하려는 것.
    const okNames = results.filter((r) => !r.error).map((r) => r.character_name);
    if (okNames.length > 0) {
      await supabase.from("extra_characters").upsert(
        okNames.map((n) => ({ project_id: projectId, user_id: currentUserId, character_name: n })),
        { onConflict: "project_id,user_id,character_name", ignoreDuplicates: true }
      );
    }

    const allBosses: FetchedBoss[] = results.flatMap((r) =>
      r.error ? [] : r.bosses.map((b) => ({ ...b, characterName: r.character_name }))
    );
    setBosses(allBosses);

    // 이미 그룹 명단에 있는 보스(이름+난이도 기준)는 기본 선택 해제.
    const initial = new Set<string>();
    for (const b of allBosses) {
      if (isAlreadyAdded(existingCandidates, b)) continue;
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
  type BossGroup = { name: string; difficulty: string; period: "weekly" | "monthly"; chars: FetchedBoss[] };
  const groups: BossGroup[] = [];
  {
    const byKey = new Map<string, BossGroup>();
    for (const b of bosses) {
      const key = `${b.name}__${normalizeNexonDifficulty(b.difficulty) ?? ""}`;
      let g = byKey.get(key);
      if (!g) {
        g = { name: b.name, difficulty: b.difficulty, period: guessPeriod(b.name, b.cycle), chars: [] };
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

    // (이름, 정규화된 난이도) 기준으로 중복 없는 보스 집합을 만든다.
    const dedup = new Map<string, FetchedBoss>();
    for (const b of toAdd) {
      const dedupeKey = `${b.name}__${normalizeNexonDifficulty(b.difficulty) ?? ""}`;
      if (!dedup.has(dedupeKey)) dedup.set(dedupeKey, b);
    }
    const uniqueBosses = [...dedup.values()];

    // 이미 group 명단에 있는 보스는 기존 id를, 없으면 새로 insert한 id를 쓴다.
    const { data: existingSortRows } = await supabase
      .from("bosses")
      .select("sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1);
    let nextOrder = (existingSortRows?.[0]?.sort_order ?? -1) + 1;

    const { data: existingFull } = await supabase
      .from("bosses")
      .select("id, name, difficulty")
      .eq("project_id", projectId);
    const bossIdByKey = new Map<string, string>();
    for (const row of (existingFull ?? []) as { id: string; name: string; difficulty: string | null }[]) {
      bossIdByKey.set(`${row.name}__${row.difficulty ?? ""}`, row.id);
    }
    const newBossRows: { project_id: string; name: string; period: "weekly" | "monthly"; difficulty: Difficulty | null; sort_order: number }[] = [];
    const newBossKeys: string[] = [];
    for (const b of uniqueBosses) {
      const normalizedDiff = normalizeNexonDifficulty(b.difficulty);
      const key = `${b.name}__${normalizedDiff ?? ""}`;
      if (bossIdByKey.has(key)) continue;
      newBossRows.push({
        project_id: projectId,
        name: b.name,
        period: guessPeriod(b.name, b.cycle),
        difficulty: normalizedDiff,
        sort_order: nextOrder++,
      });
      newBossKeys.push(key);
    }

    if (newBossRows.length > 0) {
      const { data: inserted, error: insertErr } = await supabase.from("bosses").insert(newBossRows).select("id, name, difficulty");
      if (insertErr) {
        setSaving(false);
        setError(insertErr.message);
        return;
      }
      for (const row of (inserted ?? []) as { id: string; name: string; difficulty: string | null }[]) {
        bossIdByKey.set(`${row.name}__${row.difficulty ?? ""}`, row.id);
      }
    }

    // 선택된 모든 캐릭터(보스 하나당 여러 캐릭터 가능)를 후보 풀(boss_candidates)에
    // 넣는다. party_members에는 아직 안 넣는다 -- 드래그 앤 드롭으로 직접
    // 배정하기 전까지는 후보 상태로 둔다.
    const candidateRows = toAdd.map((b) => {
      const normalizedDiff = normalizeNexonDifficulty(b.difficulty);
      const bossId = bossIdByKey.get(`${b.name}__${normalizedDiff ?? ""}`)!;
      return {
        project_id: projectId,
        boss_id: bossId,
        user_id: currentUserId,
        character_name: b.characterName,
      };
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
    router.refresh();
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">넥슨 스케줄러에서 보스 불러오기</h2>
          <p className="label">
            넥슨 스케줄러 등록 정보는 비공개라서, <b>프로필에 연동해둔 내 넥슨 API 키로 내 캐릭터(본캐+부캐)만</b>{" "}
            불러올 수 있어요 — 다른 사람 캐릭터는 그 사람이 직접 연동해서 불러와야 해요. 불러온 건 아래 "후보
            캐릭터"에 담기고, 보스 명단 쪽에서 드래그해 파티에 배정하면 돼요.
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
              {bosses.length === 0 && (
                <p className="text-muted">
                  등록된 보스가 없어요. 게임 내에서 먼저 스케줄러에 보스를 등록해주세요.
                </p>
              )}

              <div className="flex flex-col gap-2">
                {groups.map((g) => (
                  <div key={`${g.name}__${g.difficulty}`} className="flex flex-col gap-1">
                    <p className="label">
                      {g.name}
                      {/* [변경] 넥슨이 주는 영문 난이도 대신 난이도 배지 */}
                      <DifficultyBadge difficulty={normalizeNexonDifficulty(g.difficulty)} className="ml-1.5" />
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {g.chars.map((b) => {
                        const key = bossKey(b);
                        const already = isAlreadyAdded(existingCandidates, b);
                        return (
                          <label key={key} className={"pill " + (selected.has(key) ? "active" : "")}>
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={selected.has(key)}
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
