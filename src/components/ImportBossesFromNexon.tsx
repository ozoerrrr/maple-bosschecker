"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface FetchedBoss {
  name: string;
  difficulty: string;
  cycle: string;
  complete: boolean;
}

interface Props {
  projectId: string;
  existingBossNames: string[];
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

export default function ImportBossesFromNexon({ projectId, existingBossNames }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [characterName, setCharacterName] = useState<string | null>(null);
  const [bosses, setBosses] = useState<FetchedBoss[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function bossKey(b: FetchedBoss) {
    return `${b.name}__${b.difficulty}`;
  }

  function displayName(b: FetchedBoss) {
    return b.difficulty ? `${b.name} ${b.difficulty}` : b.name;
  }

  async function handleFetch() {
    setOpen(true);
    setLoading(true);
    setError(null);
    const res = await fetch("/api/nexon/boss-schedule");
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "불러오기에 실패했어요.");
      return;
    }
    setCharacterName(data.character_name);
    setBosses(data.bosses);
    // 이미 그룹 명단에 있는 보스(이름 기준)는 기본 선택 해제
    const initial = new Set<string>(
      (data.bosses as FetchedBoss[])
        .filter((b) => !existingBossNames.includes(displayName(b)))
        .map(bossKey)
    );
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
    if (toAdd.length === 0) {
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

    const rows = toAdd.map((b) => ({
      project_id: projectId,
      name: displayName(b),
      period: guessPeriod(b.name, b.cycle),
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
          <p className="text-xs text-slate-500">
            프로필에 연동한 내 캐릭터가 인게임 "스케줄러"에 등록해둔 보스를 그대로 그룹 명단에 추가할 수 있어요.
          </p>
        </div>
        {!open && (
          <button onClick={handleFetch} className="btn-secondary whitespace-nowrap">
            불러오기
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-2">
          {loading && <p className="text-sm text-slate-500">불러오는 중...</p>}
          {error && <p className="text-xs text-red-500">{error}</p>}

          {!loading && !error && (
            <>
              {characterName && (
                <p className="text-xs text-slate-500">
                  <b>{characterName}</b> 캐릭터 기준, 인게임 스케줄러에 등록된 보스 {bosses.length}개
                </p>
              )}
              {bosses.length === 0 && (
                <p className="text-sm text-slate-500">
                  등록된 보스가 없어요. 게임 내에서 먼저 스케줄러에 보스를 등록해주세요.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {bosses.map((b) => {
                  const key = bossKey(b);
                  const already = existingBossNames.includes(displayName(b));
                  return (
                    <label
                      key={key}
                      className={
                        "cursor-pointer rounded-full px-3 py-1 text-xs " +
                        (selected.has(key)
                          ? "bg-brand-500 text-white"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")
                      }
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={selected.has(key)}
                        onChange={() => toggle(key)}
                      />
                      {displayName(b)}
                      {already && " (이미 있음)"}
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button disabled={saving} onClick={handleAdd} className="btn-primary !px-3 !py-1 text-xs">
                  {saving ? "추가하는 중..." : `선택한 보스 ${selected.size}개 추가`}
                </button>
                <button onClick={() => setOpen(false)} className="btn-secondary !px-3 !py-1 text-xs">
                  취소
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
