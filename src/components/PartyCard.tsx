"use client";

import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { candidateMonthlyDates, candidateSlots, candidateSlotsNext, type ScheduleSnapshot } from "@/lib/scheduling/parties";
import type { RawBoss, RawParty } from "@/lib/scheduling/snapshot";
import type { Day } from "@/lib/scheduling/constants";
import { parseDateKey, weekdayLabelForDate } from "@/lib/scheduling/dates";
import { formatMeso, mesoPerPerson } from "@/lib/scheduling/meso";

interface Props {
  projectId: string;
  boss: RawBoss;
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

function monthlyDateLabel(dateStr: string, hour: number) {
  const { year, month0, day } = parseDateKey(dateStr);
  const weekday = weekdayLabelForDate(year, month0, day);
  return `${month0 + 1}/${day} (${weekday}) ${hour}시`;
}

// 원본 partyStatusHtml()을 포팅: 확정 전이면 후보 시간 드롭다운 + 확정 버튼,
// 확정됐으면 그 시간 표시 + 완료/취소 버튼. 월간보스는 요일 라벨 대신 실제
// 달력 날짜(candidateMonthlyDates)로 확정한다.
export default function PartyCard({ projectId, boss, party, weekMode, currentUserId, snapshot, memberName, onChanged }: Props) {
  const supabase = createClient();
  const [isPending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string>("");

  const isMonthly = boss.period === "monthly";

  const partyObj = useMemo(
    () => ({ id: party.id, project_id: projectId, boss_id: party.boss_id, label: party.label, sort_order: party.sort_order, members: party.members }),
    [party, projectId]
  );

  const confirmation = weekMode === "this" ? snapshot.confirmed[party.id] : undefined;
  const nextConfirmation = weekMode === "next" ? snapshot.nextConfirmed[party.id] : undefined;
  const cleared = confirmation?.cleared ?? false;

  const candidates = useMemo(() => {
    if (isMonthly) return [];
    if (weekMode === "this") return candidateSlots(snapshot, partyObj);
    return candidateSlotsNext(snapshot, partyObj);
  }, [snapshot, partyObj, weekMode, isMonthly]);

  const monthlyCandidates = useMemo(() => {
    if (!isMonthly) return [];
    return candidateMonthlyDates(snapshot, partyObj);
  }, [snapshot, partyObj, isMonthly]);

  const isInParty = party.members.includes(currentUserId);

  const confirmedMonthlySlot =
    isMonthly && confirmation && !confirmation.cleared && confirmation.confirmed_date && confirmation.hour != null
      ? { date: confirmation.confirmed_date, hour: confirmation.hour }
      : null;

  const confirmedSlot =
    !isMonthly && weekMode === "this"
      ? confirmation && !confirmation.cleared && confirmation.day && confirmation.hour != null
        ? { day: confirmation.day, hour: confirmation.hour }
        : null
      : !isMonthly && weekMode === "next"
      ? nextConfirmation && nextConfirmation.day && nextConfirmation.hour != null
        ? { day: nextConfirmation.day, hour: nextConfirmation.hour }
        : null
      : null;

  const meso = mesoPerPerson(boss.name, boss.difficulty, party.members.length || 1);

  function confirmSlot() {
    if (!picked) return;
    startTransition(async () => {
      if (isMonthly) {
        const [date, hourStr] = picked.split("|");
        const hour = parseInt(hourStr, 10);
        const { year, month0, day } = parseDateKey(date);
        const weekday = weekdayLabelForDate(year, month0, day);
        await supabase.from("party_confirmations").upsert({
          party_id: party.id,
          day: weekday,
          hour,
          confirmed_date: date,
          cleared: false,
          confirmed_by: currentUserId,
        });
      } else {
        const [day, hourStr] = picked.split("|");
        const hour = parseInt(hourStr, 10);
        if (weekMode === "this") {
          await supabase
            .from("party_confirmations")
            .upsert({ party_id: party.id, day, hour, confirmed_date: null, cleared: false, confirmed_by: currentUserId });
        } else {
          await supabase
            .from("next_party_confirmations")
            .upsert({ party_id: party.id, day, hour, confirmed_by: currentUserId });
        }
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

  const hasAnyConfirmed = isMonthly ? !!confirmedMonthlySlot : !!confirmedSlot;

  return (
    <div id={`party-${party.id}`} className={"party-row" + (isInParty ? " party-row--mine" : "")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-medium">{party.label || "파티"}</span>
          <span className="text-xs text-[color:var(--muted)]">
            {party.members.map((m) => memberName(m)).join(", ") || "멤버 없음"}
          </span>
        </div>

        {weekMode === "this" && cleared ? (
          <div className="flex items-center gap-2">
            <span className="status-text done">완료</span>
            <button disabled={isPending} onClick={() => toggleCleared(false)} className="text-xs text-[color:var(--muted)] underline">
              취소
            </button>
          </div>
        ) : hasAnyConfirmed ? (
          <div className="flex items-center gap-2">
            <span className="chip chip--fixed">
              {isMonthly && confirmedMonthlySlot
                ? monthlyDateLabel(confirmedMonthlySlot.date, confirmedMonthlySlot.hour)
                : confirmedSlot
                ? slotLabel(confirmedSlot.day, confirmedSlot.hour)
                : ""}{" "}
              확정
            </span>
            {weekMode === "this" && (
              <button disabled={isPending} onClick={() => toggleCleared(true)} className="status-text ready underline">
                완료
              </button>
            )}
            <button disabled={isPending} onClick={unconfirm} className="clear-btn">
              취소
            </button>
          </div>
        ) : isMonthly ? (
          monthlyCandidates.length === 0 ? (
            <span className="status-text" style={{ color: "var(--danger)" }}>
              겹치는 날짜 없음
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <select value={picked} onChange={(e) => setPicked(e.target.value)} className="confirm-select">
                <option value="">날짜 선택</option>
                {monthlyCandidates.map((s) => (
                  <option key={`${s.date}-${s.hour}`} value={`${s.date}|${s.hour}`}>
                    {monthlyDateLabel(s.date, s.hour)}
                  </option>
                ))}
              </select>
              <button disabled={isPending || !picked} onClick={confirmSlot} className="save-btn !px-3 !py-1 text-xs">
                확정
              </button>
            </div>
          )
        ) : candidates.length === 0 ? (
          <span className="status-text" style={{ color: "var(--danger)" }}>
            겹치는 시간 없음
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <select value={picked} onChange={(e) => setPicked(e.target.value)} className="confirm-select">
              <option value="">시간 선택</option>
              {candidates.map((s) => (
                <option key={`${s.day}-${s.hour}`} value={`${s.day}|${s.hour}`}>
                  {slotLabel(s.day, s.hour)}
                </option>
              ))}
            </select>
            <button disabled={isPending || !picked} onClick={confirmSlot} className="save-btn !px-3 !py-1 text-xs">
              확정
            </button>
          </div>
        )}
      </div>
      {meso != null && <div className="party-meso">1인당 {formatMeso(meso)}</div>}
    </div>
  );
}
