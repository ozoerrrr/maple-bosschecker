"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { currentYM, daysInMonth, nextMonthOf, todayDateStr, ymdKey } from "@/lib/scheduling/dates";

interface Props {
  projectId: string;
  userId: string;
  initialDates: string[]; // 내가 이미 막아둔 날짜 (YYYY-MM-DD)
  onSaved: () => void;
}

const WEEK_HEAD = ["일", "월", "화", "수", "목", "금", "토"];

// [추가] 월간 불가 날짜 입력 달력 (레이드 시간표의 toggleMonthlyBlock 포팅).
// 이번달·다음달 달력에서 날짜를 누르면 그날을 "하루 종일 안 되는 날"로 표시/해제한다.
// 저장은 monthly_block 테이블의 내 행만 추가·삭제한다 (RLS: 본인 행만 가능).
// 계산 쪽은 이미 이 테이블을 본다: 월간보스 후보에서 그 날짜가 빠지고,
// 이번주 날짜면 그 요일 전체가 주간보스 후보에서도 빠진다 (availability.ts isAvailable).
export default function MonthlyBlockCalendar({ projectId, userId, initialDates, onSaved }: Props) {
  const supabase = createClient();
  const [isPending, startTransition] = useTransition();
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set(initialDates));
  const today = todayDateStr();
  const thisMonth = currentYM();
  const months = [thisMonth, nextMonthOf(thisMonth.year, thisMonth.month0)];

  function toggle(dateStr: string) {
    if (dateStr < today) return; // 지난 날짜는 바꿀 수 없다
    const on = !blocked.has(dateStr);
    setBlocked((prev) => {
      const next = new Set(prev);
      if (on) next.add(dateStr);
      else next.delete(dateStr);
      return next;
    });
    startTransition(async () => {
      if (on) {
        await supabase.from("monthly_block").upsert({ project_id: projectId, user_id: userId, blocked_date: dateStr });
      } else {
        await supabase
          .from("monthly_block")
          .delete()
          .eq("project_id", projectId)
          .eq("user_id", userId)
          .eq("blocked_date", dateStr);
      }
      onSaved();
    });
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <h4 className="text-sm font-bold text-slate-800">📅 안 되는 날짜</h4>
      <p className="sub mt-1 text-xs">
        누른 날짜는 하루 종일 안 되는 날로 표시돼요. 월간보스 후보에서 빠지고, 이번주 날짜면 그 요일의 주간보스
        후보에서도 빠져요.
      </p>
      <div className="mt-3 grid gap-5 sm:grid-cols-2">
        {months.map(({ year, month0 }) => {
          const firstDow = new Date(year, month0, 1).getDay();
          const numDays = daysInMonth(year, month0);
          const cells: (number | null)[] = [
            ...Array.from({ length: firstDow }, () => null),
            ...Array.from({ length: numDays }, (_, i) => i + 1),
          ];
          return (
            <div key={`${year}-${month0}`}>
              <div className="mb-1.5 text-xs font-bold text-slate-600">
                {year}년 {month0 + 1}월
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {WEEK_HEAD.map((w) => (
                  <div key={w} className="text-[10px] text-slate-400">
                    {w}
                  </div>
                ))}
                {cells.map((d, i) => {
                  if (d == null) return <div key={`empty-${i}`} />;
                  const ds = ymdKey(year, month0, d);
                  const past = ds < today;
                  const on = blocked.has(ds);
                  return (
                    <button
                      key={ds}
                      type="button"
                      disabled={past || isPending}
                      onClick={() => toggle(ds)}
                      aria-pressed={on}
                      aria-label={`${month0 + 1}월 ${d}일 ${on ? "안 되는 날 해제" : "안 되는 날로 표시"}`}
                      className={
                        "h-8 rounded-md border text-xs font-semibold transition " +
                        (on
                          ? "border-red-400 bg-red-50 text-red-600 line-through"
                          : past
                          ? "border-transparent text-slate-300"
                          : "border-slate-200 bg-white text-slate-700 hover:border-orange-300") +
                        (ds === today ? " ring-1 ring-slate-400" : "")
                      }
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
