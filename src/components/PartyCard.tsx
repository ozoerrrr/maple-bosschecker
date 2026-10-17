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
  isOwner: boolean; // [추가] 그룹장이면 모든 파티 일정을 수정할 수 있다
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
export default function PartyCard({ projectId, boss, party, weekMode, currentUserId, isOwner, snapshot, memberName, onChanged }: Props) {
  const supabase = createClient();
  const [isPending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string>("");

  const isMonthly = boss.period === "monthly";

  const partyObj = useMemo(
    () => ({
      id: party.id,
      project_id: projectId,
      boss_id: party.boss_id,
      label: party.label,
      sort_order: party.sort_order,
      members: party.members.map((m) => m.userId),
    }),
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

  const isInParty = party.members.some((m) => m.userId === currentUserId);
  // [추가] 확정·완료·해제 권한: 이 파티의 파티원 또는 그룹장만 가능
  // (DB에서도 0009 마이그레이션의 RLS로 같은 규칙을 강제한다)
  const canEdit = isInParty || isOwner;

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
    if (!canEdit || !picked) return; // [추가] 권한이 없으면 확정 불가
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
        // [추가] 월간보스 우선: 이번주 날짜면 같은 요일·시각에 한도를 넘는 주간 확정을 DB 함수(0010)가 밀어낸다
        await supabase.rpc("push_out_weekly_for_monthly", { p_party_id: party.id });
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
    if (!canEdit) return; // [추가] 권한이 없으면 완료 처리 불가
    startTransition(async () => {
      // [추가] 시간 없이 "바로 클리어"한 파티의 완료를 취소하면 확정 전 상태로 되돌린다(행 삭제)
      const isInstant = !next && confirmation && confirmation.day == null && confirmation.confirmed_date == null;
      if (isInstant) {
        await supabase.from("party_confirmations").delete().eq("party_id", party.id);
      } else {
        await supabase.from("party_confirmations").update({ cleared: next }).eq("party_id", party.id);
      }
      onChanged();
    });
  }

  // [추가] 즉석 클리어: 시간을 확정하지 않고 바로 완료로 저장한다 (레이드 시간표의 "클리어" 바로 누르기).
  // 시간 칸(day/hour/confirmed_date)은 비워 두고 cleared만 true로 둔다.
  function instantClear() {
    if (!canEdit) return;
    startTransition(async () => {
      await supabase.from("party_confirmations").upsert({
        party_id: party.id,
        day: null,
        hour: null,
        confirmed_date: null,
        cleared: true,
        confirmed_by: currentUserId,
      });
      onChanged();
    });
  }

  function unconfirm() {
    if (!canEdit) return; // [추가] 권한이 없으면 확정 해제 불가
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
            {party.members
              .map((m) => (m.characterName ? `${memberName(m.userId)} (${m.characterName})` : memberName(m.userId)))
              .join(", ") || "멤버 없음"}
          </span>
        </div>

        {weekMode === "this" && cleared ? (
          <div className="flex items-center gap-2">
            <span className="status-text done">완료</span>
            {/* [추가] 파티원·그룹장만 완료 취소 가능 */}
            {canEdit && (
              <button disabled={isPending} onClick={() => toggleCleared(false)} className="text-xs text-[color:var(--muted)] underline">
                취소
              </button>
            )}
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
            {/* [추가] 파티원·그룹장만 완료 처리/확정 취소 가능 */}
            {canEdit && weekMode === "this" && (
              <button disabled={isPending} onClick={() => toggleCleared(true)} className="status-text ready underline">
                완료
              </button>
            )}
            {canEdit && (
              <button disabled={isPending} onClick={unconfirm} className="clear-btn">
                취소
              </button>
            )}
          </div>
        ) : (
          // [추가] 확정 전 상태: 시간 선택(또는 안내)과 "바로 클리어" 버튼을 나란히 둔다
          <div className="flex flex-wrap items-center gap-2">
          {isMonthly ? (
          monthlyCandidates.length === 0 ? (
            <span className="status-text" style={{ color: "var(--danger)" }}>
              겹치는 날짜 없음
            </span>
          ) : !canEdit ? (
            // [추가] 권한이 없으면 드롭다운 대신 안내 배지만 표시
            <span className="status-text">후보 {monthlyCandidates.length}개 · 파티원 확정 대기</span>
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
        ) : !canEdit ? (
          // [추가] 권한이 없으면 드롭다운 대신 안내 배지만 표시
          <span className="status-text">후보 {candidates.length}개 · 파티원 확정 대기</span>
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
          {/* [추가] 즉석 클리어 버튼: 파티원·그룹장만, 이번주(월간은 항상 이번주 기준)만 */}
          {canEdit && weekMode === "this" && (
            <button disabled={isPending} onClick={instantClear} className="text-xs text-[color:var(--muted)] underline">
              바로 클리어
            </button>
          )}
          </div>
        )}
      </div>
      {meso != null && <div className="party-meso">1인당 {formatMeso(meso)}</div>}
    </div>
  );
}
