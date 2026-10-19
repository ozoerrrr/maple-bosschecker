"use client";

import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { candidateMonthlyDates, candidateSlots, candidateSlotsNext, type ScheduleSnapshot } from "@/lib/scheduling/parties";
import type { RawBoss, RawParty } from "@/lib/scheduling/snapshot";
import type { Day } from "@/lib/scheduling/constants";
import { dateSlotLabel, parseDateKey, slotLabel as shortSlotLabel, weekdayLabelForDate } from "@/lib/scheduling/dates";

interface Props {
  projectId: string;
  boss: RawBoss;
  party: RawParty;
  partyIndex: number; // [추가] 보스 안에서 몇 번째 파티인지 (이름 없는 파티를 "N파티"로 표시)
  weekMode: "this" | "next";
  currentUserId: string;
  isOwner: boolean; // [추가] 그룹장이면 모든 파티 일정을 수정할 수 있다
  snapshot: ScheduleSnapshot;
  memberName: (uid: string) => string;
  onChanged: () => void;
}

// [변경] 표기는 dates.ts의 공통 함수를 쓴다: "일요일 19시" -> "일 19시"
function slotLabel(day: Day, hour: number) {
  return shortSlotLabel(day, hour);
}

function monthlyDateLabel(dateStr: string, hour: number) {
  return dateSlotLabel(dateStr, hour); // [변경] 공통 표기 함수 사용
}

// 원본 partyStatusHtml()을 포팅: 확정 전이면 후보 시간 드롭다운 + 확정 버튼,
// 확정됐으면 그 시간 표시 + 완료/취소 버튼. 월간보스는 요일 라벨 대신 실제
// 달력 날짜(candidateMonthlyDates)로 확정한다.
export default function PartyCard({ projectId, boss, party, partyIndex, weekMode, currentUserId, isOwner, snapshot, memberName, onChanged }: Props) {
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

  // [추가] 가능 시간을 아직 안 넣은 파티원 (월간·이번주 탭은 이번주 시간표, 다음주 탭은 다음주 시간표 기준).
  // 이런 파티원이 있으면 확정 후보를 계산하지 않고 누가 안 넣었는지 보여준다.
  const missingMembers = useMemo(() => {
    const src = isMonthly || weekMode === "this" ? snapshot.avail : snapshot.nextAvail;
    return party.members.filter((m) => !src[m.userId]?.length);
  }, [party, snapshot, weekMode, isMonthly]);
  const missingLabel = missingMembers.length
    ? `시간 미입력: ${missingMembers.map((m) => memberName(m.userId)).join(", ")}`
    : "";

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

  // [추가] 클리어한 파티도 확정했던 시간이 있으면 시간 칩으로 보여준다 (즉석 클리어는 시간 없음)
  const clearedTimeLabel =
    weekMode === "this" && cleared && confirmation && confirmation.hour != null
      ? isMonthly && confirmation.confirmed_date
        ? monthlyDateLabel(confirmation.confirmed_date, confirmation.hour)
        : confirmation.day
        ? slotLabel(confirmation.day, confirmation.hour)
        : null
      : null;

  // [추가] 확정 칩 글자
  const confirmedLabel =
    isMonthly && confirmedMonthlySlot
      ? monthlyDateLabel(confirmedMonthlySlot.date, confirmedMonthlySlot.hour)
      : confirmedSlot
      ? slotLabel(confirmedSlot.day, confirmedSlot.hour)
      : "";

  // [변경] 파티 줄 레이아웃: [파티 이름] | 참여자 칩들 ...... [확정 칩] (클리어)
  return (
    <div id={`party-${party.id}`} className={"party-row" + (isInParty ? " party-row--mine" : "")}>
      {/* [추가] 파티 이름: 이름이 없으면 순번으로 "1파티, 2파티…" */}
      <span className="party-name">{party.label || `${partyIndex + 1}파티`}</span>

      {/* [변경] 참여자를 "이름 · 캐릭" 칩으로, 내 칩은 주황으로 강조 */}
      <div className="party-members">
        {party.members.length === 0 ? (
          <span className="text-xs text-[color:var(--muted)]">멤버 없음</span>
        ) : (
          party.members.map((m, i) => (
            <span key={`${m.userId}-${i}`} className={"chip" + (m.userId === currentUserId ? " me" : "")}>
              {memberName(m.userId)}
              {m.characterName && <span className="chip-sub">· {m.characterName}</span>}
            </span>
          ))
        )}
      </div>

      <div className="party-status">
        {weekMode === "this" && cleared ? (
          <>
            {clearedTimeLabel && <span className="chip chip--fixed">{clearedTimeLabel}</span>}
            {/* [변경] "완료" -> 클리어 타원 버튼. 클리어 상태에서 다시 누르면 클리어 취소 (파티원·그룹장만) */}
            <button
              type="button"
              disabled={isPending || !canEdit}
              onClick={() => toggleCleared(false)}
              className="clear-btn done"
              title={canEdit ? "다시 누르면 클리어 취소" : undefined}
            >
              클리어 ✓
            </button>
          </>
        ) : hasAnyConfirmed ? (
          <>
            {/* [변경] 확정 칩 안의 ×로 확정 해제 (기존 "취소" 버튼 대체) */}
            <span className="chip chip--fixed">
              {confirmedLabel} 확정
              {canEdit && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={unconfirm}
                  className="chip-x"
                  aria-label="확정 취소"
                  title="확정 취소"
                >
                  ×
                </button>
              )}
            </span>
            {canEdit && weekMode === "this" && (
              <button type="button" disabled={isPending} onClick={() => toggleCleared(true)} className="clear-btn">
                클리어
              </button>
            )}
          </>
        ) : (
          // 확정 전 상태: 시간 선택(또는 안내) + 즉석 클리어 버튼
          <>
            {missingLabel ? (
              // [추가] 가능 시간을 안 넣은 파티원이 있으면 드롭다운 대신 안내
              <span className="status-text">{missingLabel}</span>
            ) : isMonthly ? (
              monthlyCandidates.length === 0 ? (
                <span className="status-text" style={{ color: "var(--danger)" }}>
                  겹치는 날짜 없음
                </span>
              ) : !canEdit ? (
                // [추가] 권한이 없으면 드롭다운 대신 안내만 표시
                <span className="status-text">후보 {monthlyCandidates.length}개 · 파티원 확정 대기</span>
              ) : (
                <>
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
                </>
              )
            ) : candidates.length === 0 ? (
              <span className="status-text" style={{ color: "var(--danger)" }}>
                겹치는 시간 없음
              </span>
            ) : !canEdit ? (
              // [추가] 권한이 없으면 드롭다운 대신 안내만 표시
              <span className="status-text">후보 {candidates.length}개 · 파티원 확정 대기</span>
            ) : (
              <>
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
              </>
            )}
            {/* [변경] 즉석 클리어도 같은 클리어 버튼으로: 파티원·그룹장만, 이번주(월간은 항상 이번주 기준)만 */}
            {canEdit && weekMode === "this" && (
              <button type="button" disabled={isPending} onClick={instantClear} className="clear-btn" title="시간 확정 없이 바로 클리어">
                클리어
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
