"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DIFFICULTIES, DIFFICULTY_LABEL, parseTrailingDifficulty } from "@/lib/scheduling/meso";
import type { Difficulty } from "@/lib/scheduling/types";

interface Boss {
  id: string;
  name: string;
  period: "weekly" | "monthly";
  difficulty: Difficulty | null;
  sort_order: number;
}

interface Party {
  id: string;
  boss_id: string;
  label: string | null;
  sort_order: number;
  members: string[];
}

interface Member {
  id: string;
  name: string;
  role: string;
}

interface Props {
  projectId: string;
  bosses: Boss[];
  parties: Party[];
  members: Member[];
}

// 보스/파티를 직접 CRUD하는 설정 화면. 원본의 하드코딩된 BOSS_ORDER +
// RAW_PARTIES + "예약된 변경사항" 메커니즘을 대신한다 -- 여기서 하는 모든
// 조작은 바로 실제 DB 행이라, 재배포나 예약 개념 자체가 필요 없다.
export default function BossRosterEditor({ projectId, bosses, parties, members }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [newBossName, setNewBossName] = useState("");
  const [newBossPeriod, setNewBossPeriod] = useState<"weekly" | "monthly">("weekly");
  const [newBossDifficulty, setNewBossDifficulty] = useState<Difficulty | "">("");
  const [addingPartyFor, setAddingPartyFor] = useState<string | null>(null);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [editingBossNameId, setEditingBossNameId] = useState<string | null>(null);
  const [editingBossNameValue, setEditingBossNameValue] = useState("");

  function refresh() {
    router.refresh();
  }

  function addBoss(e: React.FormEvent) {
    e.preventDefault();
    if (!newBossName.trim()) return;
    // "세렌 H"처럼 옛날 습관대로 이름에 난이도를 붙여 쳐도, 난이도 드롭다운을
    // 따로 안 골랐으면 이름에서 떼어내 난이도 필드로 돌려준다 (이름엔 깨끗한
    // 보스 이름만 남겨서, 메소 계산용 MESO_TABLE 조회가 이름으로 정확히 맞게).
    const parsed = parseTrailingDifficulty(newBossName);
    const finalName = newBossDifficulty ? newBossName.trim() : parsed.name;
    const finalDifficulty = newBossDifficulty || parsed.difficulty || null;
    const sortOrder = bosses.length ? Math.max(...bosses.map((b) => b.sort_order)) + 1 : 0;
    startTransition(async () => {
      await supabase.from("bosses").insert({
        project_id: projectId,
        name: finalName,
        period: newBossPeriod,
        difficulty: finalDifficulty,
        sort_order: sortOrder,
      });
      setNewBossName("");
      setNewBossDifficulty("");
      refresh();
    });
  }

  function updateBossDifficulty(boss: Boss, difficulty: Difficulty | "") {
    startTransition(async () => {
      await supabase.from("bosses").update({ difficulty: difficulty || null }).eq("id", boss.id);
      refresh();
    });
  }

  function startRenameBoss(boss: Boss) {
    setEditingBossNameId(boss.id);
    setEditingBossNameValue(boss.name);
  }

  function saveBossName(boss: Boss) {
    const trimmed = editingBossNameValue.trim();
    setEditingBossNameId(null);
    if (!trimmed || trimmed === boss.name) return;
    // 기존에 "세렌 H"처럼 이름에 난이도가 섞여 있던 걸 고치는 경우도 커버:
    // 아직 난이도가 안 정해져 있으면 뒤에 붙은 난이도 약자를 떼어 준다.
    const parsed = parseTrailingDifficulty(trimmed);
    const finalName = boss.difficulty ? trimmed : parsed.name;
    const finalDifficulty = boss.difficulty ?? parsed.difficulty ?? null;
    startTransition(async () => {
      await supabase.from("bosses").update({ name: finalName, difficulty: finalDifficulty }).eq("id", boss.id);
      refresh();
    });
  }

  function deleteBoss(id: string) {
    if (!confirm("이 보스와 소속 파티를 모두 삭제할까요?")) return;
    startTransition(async () => {
      await supabase.from("bosses").delete().eq("id", id);
      refresh();
    });
  }

  function moveBoss(boss: Boss, direction: -1 | 1) {
    const sorted = [...bosses].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((b) => b.id === boss.id);
    const swapWith = sorted[idx + direction];
    if (!swapWith) return;
    startTransition(async () => {
      await supabase.from("bosses").update({ sort_order: swapWith.sort_order }).eq("id", boss.id);
      await supabase.from("bosses").update({ sort_order: boss.sort_order }).eq("id", swapWith.id);
      refresh();
    });
  }

  function deleteParty(id: string) {
    startTransition(async () => {
      await supabase.from("parties").delete().eq("id", id);
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={addBoss} className="card flex flex-wrap items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label className="label">새 보스 이름</label>
          <input
            value={newBossName}
            onChange={(e) => setNewBossName(e.target.value)}
            placeholder="예: 세렌 (난이도는 오른쪽에서 따로 선택)"
            className="input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">주기</label>
          <select
            value={newBossPeriod}
            onChange={(e) => setNewBossPeriod(e.target.value as "weekly" | "monthly")}
            className="input"
          >
            <option value="weekly">주간</option>
            <option value="monthly">월간</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">난이도 (메소 계산용, 선택)</label>
          <select
            value={newBossDifficulty}
            onChange={(e) => setNewBossDifficulty(e.target.value as Difficulty | "")}
            className="input"
          >
            <option value="">없음</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={isPending || !newBossName.trim()} className="btn-primary">
          보스 추가
        </button>
      </form>

      {bosses.length === 0 && (
        <p className="card text-muted">
          아직 보스가 없어요. 위에서 그룹이 도는 보스를 하나씩 추가해주세요 (보스 이름만 적고, 난이도는 옆 드롭다운에서 골라주세요).
        </p>
      )}

      {[...bosses]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((boss, idx, arr) => {
          const bossParties = parties.filter((p) => p.boss_id === boss.id).sort((a, b) => a.sort_order - b.sort_order);
          return (
            <div key={boss.id} className="card flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {editingBossNameId === boss.id ? (
                    <input
                      autoFocus
                      value={editingBossNameValue}
                      onChange={(e) => setEditingBossNameValue(e.target.value)}
                      onBlur={() => saveBossName(boss)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveBossName(boss);
                        if (e.key === "Escape") setEditingBossNameId(null);
                      }}
                      className="input !w-32 !py-1"
                    />
                  ) : (
                    <h3
                      className="font-semibold cursor-pointer"
                      title="눌러서 이름 수정"
                      onClick={() => startRenameBoss(boss)}
                    >
                      {boss.name}
                    </h3>
                  )}
                  <select
                    value={boss.difficulty ?? ""}
                    onChange={(e) => updateBossDifficulty(boss, e.target.value as Difficulty | "")}
                    className="confirm-select"
                    title="난이도 (메소 계산용)"
                  >
                    <option value="">난이도 없음</option>
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {DIFFICULTY_LABEL[d]}
                      </option>
                    ))}
                  </select>
                  <span className="period-badge">
                    {boss.period === "monthly" ? "월간" : "주간"}
                  </span>
                </div>
                <div className="flex gap-1 text-xs">
                  <button disabled={idx === 0} onClick={() => moveBoss(boss, -1)} className="btn-secondary !px-2 !py-1">
                    ↑
                  </button>
                  <button disabled={idx === arr.length - 1} onClick={() => moveBoss(boss, 1)} className="btn-secondary !px-2 !py-1">
                    ↓
                  </button>
                  <button onClick={() => deleteBoss(boss.id)} className="btn-secondary !px-2 !py-1 text-red-500">
                    삭제
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                {bossParties.map((p) => (
                  <div key={p.id} className="flex items-center justify-between row-sub px-3 py-1.5 text-sm">
                    <div>
                      <span className="font-medium">{p.label || "파티"}</span>{" "}
                      <span className="text-muted text-xs">
                        {p.members.map((uid) => members.find((m) => m.id === uid)?.name ?? "?").join(", ") || "멤버 없음"}
                      </span>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => setEditingParty(p)} className="underline">
                        수정
                      </button>
                      <button onClick={() => deleteParty(p.id)} className="text-red-500 underline">
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {addingPartyFor === boss.id ? (
                <PartyEditorForm
                  projectId={projectId}
                  bossId={boss.id}
                  members={members}
                  sortOrder={bossParties.length}
                  onDone={() => {
                    setAddingPartyFor(null);
                    refresh();
                  }}
                  onCancel={() => setAddingPartyFor(null)}
                />
              ) : (
                <button onClick={() => setAddingPartyFor(boss.id)} className="btn-secondary self-start !py-1 text-xs">
                  + 파티 추가
                </button>
              )}
            </div>
          );
        })}

      {editingParty && (
        <PartyEditorForm
          projectId={projectId}
          bossId={editingParty.boss_id}
          party={editingParty}
          members={members}
          sortOrder={editingParty.sort_order}
          onDone={() => {
            setEditingParty(null);
            refresh();
          }}
          onCancel={() => setEditingParty(null)}
        />
      )}
    </div>
  );
}

function PartyEditorForm({
  projectId,
  bossId,
  party,
  members,
  sortOrder,
  onDone,
  onCancel,
}: {
  projectId: string;
  bossId: string;
  party?: Party;
  members: Member[];
  sortOrder: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const supabase = createClient();
  const [label, setLabel] = useState(party?.label ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(party?.members ?? []));
  const [isPending, startTransition] = useTransition();

  function toggleMember(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
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
          .insert({ project_id: projectId, boss_id: bossId, label: label.trim() || null, sort_order: sortOrder })
          .select("id")
          .single();
        partyId = data?.id;
      }
      if (partyId && selected.size > 0) {
        await supabase.from("party_members").insert(Array.from(selected).map((uid) => ({ party_id: partyId!, user_id: uid })));
      }
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg p-3" style={{ border: "1.5px dashed var(--border)" }}>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="파티 이름 (선택, 예: 1파티)"
        className="input"
      />
      <div className="flex flex-wrap gap-2">
        {members.map((m) => (
          <label
            key={m.id}
            className={
              "pill " + (selected.has(m.id) ? "active" : "")
            }
          >
            <input type="checkbox" className="hidden" checked={selected.has(m.id)} onChange={() => toggleMember(m.id)} />
            {m.name}
          </label>
        ))}
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
