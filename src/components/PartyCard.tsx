"use client";

import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { candidateSlots, candidateSlotsNext, type ScheduleSnapshot } from "@/lib/scheduling/parties";
import type { RawParty } from "@/lib/scheduling/snapshot";
import type { Day } from "@/lib/scheduling/constants";

interface Props {
  projectId: string;
  party: RawParty;
  weekMode: "this" | "next";
  currentUserId: string;
  snapshot: ScheduleSnapshot;
  memberName: (uid: string) => string;
  onChanged: () => void;
}

function slotLabel(day: Day, hour: number) {
  return `${day}요일 ${hour}시`;
}

// 원본 partyStatusHtml()을 포팅: 확정 전이면 후보 시간 드롭다운 + 확정 버튼,
// 확정됐으면 그 시간 표시 + 완료/취소 버튼.
export default function PartyCard({ projectId, party, weekMode, currentUserId, snapshot, memberName, onChanged }: Props) {
  const supabase = createClient();
  const [isPending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string>("");

  const partyObj = useMemo(
    () => ({ id: party.id, project_id: projectId, boss_id: party.boss_id, label: party.label, sort_order: party.sort_order, members: party.members }),
    [party, projectId]
  );

  const confirmation = weekMode === "this" ? snapshot.confirmed[party.id] : undefined;
  const nextConfirmation = weekMode === "next" ? snapshot.nextConfirmed[party.id] : undefined;
  const cleared = confirmation?.cleared ?? false;

  const candidates = useMemo(() => {
    if (weekMode === "this") return candidateSlots(snapshot, partyObj);
    return candidateSlotsNext(snapshot, partyObj);
  }, [snapshot, partyObj, weekMode]);

  const isInParty = party.members.includes(currentUserId);
  const confirmedSlot =
    weekMode === "this"
      ? confirmation && !confirmation.cleared && confirmation.day && confirmation.hour != null
        ? { day: confirmation.day, hour: confirmation.hour }
        : null
      : nextConfirmation && nextConfirmation.day && nextConfirmation.hour != null
      ? { day: nextConfirmation.day, hour: nextConfirmation.hour }
      : null;

  function confirmSlot() {
    if (!picked) return;
    const [day, hourStr] = picked.split("|");
    const hour = parseInt(hourStr, 10);
    startTransition(async () => {
      if (weekMode === "this") {
        await supabase
          .from("party_confirmations")
          .upsert({ party_id: party.id, day, hour, cleared: false, confirmed_by: currentUserId });
      } else {
        await supabase
          .from("next_party_confirmations")
          .upsert({ party_id: party.id, day, hour, confirmed_by: currentUserId });
      }
      onChanged();
    });
  }

  function toggleCleared(next: boolean) {
    startTransition(async () => {
      await supabase.from("party_confirmations").update({ cleared: next }).eq("party_id", party.id);
      onChanged();
    });
  }

  function unconfirm() {
    startTransition(async () => {
      if (weekMode === "this") {
        await supabase.from("party_confirmations").delete().eq("party_id", party.id);
      } else {
        await supabase.from("next_party_confirmations").delete().eq("party_id", party.id);
      }
      onChanged();
    });
  }

  return (
    <div
      id={`party-${party.id}`}
      className={
        "rounded-xl border px-3 py-2 text-sm " +
        (isInParty ? "border-brand-300 bg-brand-50/50 dark:bg-brand-900/10" : "border-slate-200 dark:border-slate-800")
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-medium">{party.label || "파티"}</span>
          <span className="text-xs text-slate-400">
            {party.members.map((m) => memberName(m)).join(", ") || "멤버 없음"}
          </span>
        </div>

        {weekMode === "this" && cleared ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              완료
            </span>
            <button disabled={isPending} onClick={() => toggleCleared(false)} className="text-xs text-slate-400 underline">
              취소
            </button>
          </div>
        ) : confirmedSlot ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              {slotLabel(confirmedSlot.day, confirmedSlot.hour)} 확정
            </span>
            {weekMode === "this" && (
              <button disabled={isPending} onClick={() => toggleCleared(true)} className="text-xs text-emerald-600 underline">
                완료
              </button>
            )}
            <button disabled={isPending} onClick={unconfirm} className="text-xs text-slate-400 underline">
              취소
            </button>
          </div>
        ) : candidates.length === 0 ? (
          <span className="text-xs text-red-400">겹치는 시간 없음</span>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">시간 선택</option>
              {candidates.map((s) => (
                <option key={`${s.day}-${s.hour}`} value={`${s.day}|${s.hour}`}>
                  {slotLabel(s.day, s.hour)}
                </option>
              ))}
            </select>
            <button disabled={isPending || !picked} onClick={confirmSlot} className="btn-primary !px-3 !py-1 text-xs">
              확정
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
