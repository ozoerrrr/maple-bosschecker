"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeNexonDifficulty } from "@/lib/scheduling/meso";

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

interface Props {
  projectId: string;
  existingBosses: ExistingBoss[];
  /** 프로필에 연동해둔 내 본캐 닉네임. 캐릭터 입력칸의 기본값으로 쓴다. */
  myCharacterName?: string | null;
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

export default function ImportBossesFromNexon({ projectId, existingBosses, myCharacterName }: Props) {
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

    // 이미 그룹 명단에 있는 보스(이름+난이도 기준)는 기본 선택 해제.
    // 같은 보스+난이도를 여러 캐릭터가 함께 등록해둔 경우엔 중복 선택을
    // 피하기 위해 처음 등장한 것 하나만 기본 선택한다 (추가할 땐 어차피
    // 이름+난이도 기준으로 한 번만 insert 된다).
    const seen = new Set<string>();
    const initial = new Set<string>();
    for (const b of allBosses) {
      if (isAlreadyAdded(existingBosses, b)) continue;
      const dedupeKey = `${b.name}__${normalizeNexonDifficulty(b.difficulty)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
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

  async function handleAdd() {
    const toAdd = bosses.filter((b) => selected.has(bossKey(b)));
    // 같은 (이름, 난이도) 보스를 여러 캐릭터에서 중복 선택했더라도 그룹
    // 보스 명단엔 한 번만 추가한다.
    const dedup = new Map<string, FetchedBoss>();
    for (const b of toAdd) {
      const dedupeKey = `${b.name}__${normalizeNexonDifficulty(b.difficulty)}`;
      if (!dedup.has(dedupeKey)) dedup.set(dedupeKey, b);
    }
    const uniqueToAdd = [...dedup.values()];
    if (uniqueToAdd.length === 0) {
      setOpen(false);
      return;
    }
    setSaving(true);
    // 현재 project의 보스 중 가장 큰 sort_order부터 이어 붙인다.
    const { data: existing } = await supabase
      .from("bosses")
      .select("sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1);
    let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const rows = uniqueToAdd.map((b) => ({
      project_id: projectId,
      name: b.name,
      period: guessPeriod(b.name, b.cycle),
      difficulty: normalizeNexonDifficulty(b.difficulty),
      sort_order: nextOrder++,
    }));

    const { error } = await supabase.from("bosses").insert(rows);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">넥슨 스케줄러에서 보스 불러오기</h2>
          <p className="label">
            캐릭터(본캐+부캐)들이 인게임 "스케줄러"에 등록해둔 보스를 한 번에 그룹 명단에 추가할 수 있어요.
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
            <p className="label">조회할 캐릭터</p>
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
              <div className="flex flex-wrap gap-2">
                {bosses.map((b) => {
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
                      {displayName(b)}
                      <span className="text-muted"> ({b.characterName})</span>
                      {already && " (이미 있음)"}
                    </label>
                  );
                })}
              </div>
              {bosses.length > 0 && (
                <div className="flex gap-2">
                  <button disabled={saving} onClick={handleAdd} className="btn-primary !px-3 !py-1 text-xs">
                    {saving ? "추가하는 중..." : `선택한 보스 ${selected.size}개 추가`}
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
