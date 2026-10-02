"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeNexonDifficulty } from "@/lib/scheduling/meso";
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

interface ExistingBoss {
  name: string;
  difficulty: string | null;
}

interface MemberOption {
  id: string;
  name: string;
}

interface Props {
  projectId: string;
  existingBosses: ExistingBoss[];
  /** 프로필에 연동해둔 내 본캐 닉네임. 캐릭터 입력칸의 기본값으로 쓴다. */
  myCharacterName?: string | null;
  /** 그룹 멤버 목록 -- 조회한 캐릭터가 누구 소속인지 태깅할 때 쓴다. */
  members: MemberOption[];
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

function isAlreadyAdded(existingBosses: ExistingBoss[], b: FetchedBoss): boolean {
  const normalized = normalizeNexonDifficulty(b.difficulty);
  return existingBosses.some((e) => e.name === b.name && e.difficulty === normalized);
}

export default function ImportBossesFromNexon({
  projectId,
  existingBosses,
  myCharacterName,
  members,
  currentUserId,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [characterNames, setCharacterNames] = useState<string[]>(myCharacterName ? [myCharacterName] : []);
  const [nameInput, setNameInput] = useState("");
  const [fetched, setFetched] = useState(false);
  const [charErrors, setCharErrors] = useState<{ characterName: string; error: string }[]>([]);
  const [bosses, setBosses] = useState<FetchedBoss[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 조회된 캐릭터 닉네임 -> 이 캐릭터가 소속된 프로젝트 멤버 id. 기본은
  // 본인(소유자)이고, 소유자가 드롭다운으로 다른 멤버로 바꿀 수 있다
  // (넥슨 API는 닉네임만 알면 조회되지 계정 소유권을 증명하는 게 아니라서).
  const [ownerByCharacter, setOwnerByCharacter] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function bossKey(b: FetchedBoss) {
    return `${b.characterName}__${b.name}__${b.difficulty}`;
  }

  function displayName(b: FetchedBoss) {
    return b.difficulty ? `${b.name} ${b.difficulty}` : b.name;
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

    const allBosses: FetchedBoss[] = results.flatMap((r) =>
      r.error ? [] : r.bosses.map((b) => ({ ...b, characterName: r.character_name }))
    );
    setBosses(allBosses);

    // 조회된 캐릭터마다 기본 소속 멤버는 본인(소유자). 매번 새로 조회해도
    // 이미 지정해둔 건 그대로 둔다.
    setOwnerByCharacter((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (!next[r.character_name]) next[r.character_name] = currentUserId;
      }
      return next;
    });

    // 이미 그룹 명단에 있는 보스(이름+난이도 기준)는 기본 선택 해제.
    const initial = new Set<string>();
    for (const b of allBosses) {
      if (isAlreadyAdded(existingBosses, b)) continue;
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
        user_id: ownerByCharacter[b.characterName] ?? currentUserId,
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
            캐릭터(본캐+부캐, 그룹원 전체)들이 인게임 "스케줄러"에 등록해둔 보스를 한 번에 불러와 후보로 담아둘 수 있어요.
            이후 보스 명단 아래 "후보 캐릭터"에서 드래그해 파티에 배정하면 돼요.
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
            <p className="label">조회할 캐릭터 (그룹원 누구 캐릭터든 닉네임만 알면 추가 가능)</p>
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

              {/* 조회된 캐릭터별로 소속 멤버 지정 */}
              {characterNames.filter((n) => bosses.some((b) => b.characterName === n)).length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="label">캐릭터별 소속 멤버 지정</p>
                  <div className="flex flex-col gap-1">
                    {[...new Set(bosses.map((b) => b.characterName))].map((charName) => (
                      <div key={charName} className="flex items-center justify-between gap-2 text-sm">
                        <span>{charName}</span>
                        <select
                          value={ownerByCharacter[charName] ?? currentUserId}
                          onChange={(e) =>
                            setOwnerByCharacter((prev) => ({ ...prev, [charName]: e.target.value }))
                          }
                          className="confirm-select"
                        >
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {groups.map((g) => (
                  <div key={`${g.name}__${g.difficulty}`} className="flex flex-col gap-1">
                    <p className="label">
                      {g.name}
                      {g.difficulty ? ` ${g.difficulty}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {g.chars.map((b) => {
                        const key = bossKey(b);
                        const already = isAlreadyAdded(existingBosses, b);
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
