"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { DAYS, HOURS, type Day } from "@/lib/scheduling/constants";
import type { RawAvailabilityRow } from "@/lib/scheduling/snapshot";

interface Props {
  projectId: string;
  userId: string;
  weekMode: "this" | "next";
  initialSlots: RawAvailabilityRow[];
  onSaved: () => void;
}

function key(day: Day, hour: number) {
  return `${day}-${hour}`;
}

// 원본의 "요일로 보기" 그리드(요일 x 24시간 토글). 칸을 누르면 즉시
// Supabase에 upsert/delete 한다 (원본은 로컬 STATE만 바꾸고 "변경사항 저장"
// 버튼을 눌러야 공유됐지만, 여기선 그룹원들이 실시간으로 DB를 보므로 매
// 클릭이 바로 반영되는 쪽이 더 자연스럽다).
export default function AvailabilityGrid({ projectId, userId, weekMode, initialSlots, onSaved }: Props) {
  const supabase = createClient();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSlots.map((s) => key(s.day as Day, s.hour)))
  );

  const table = weekMode === "this" ? "availability" : "next_availability";

  function toggle(day: Day, hour: number) {
    const k = key(day, hour);
    const next = new Set(selected);
    const willBeOn = !next.has(k);
    if (willBeOn) next.add(k);
    else next.delete(k);
    setSelected(next);

    startTransition(async () => {
      if (willBeOn) {
        await supabase.from(table).upsert({ project_id: projectId, user_id: userId, day, hour });
      } else {
        await supabase.from(table).delete().match({ project_id: projectId, user_id: userId, day, hour });
      }
      onSaved();
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[2px] text-center">
        <thead>
          <tr>
            <th className="w-8 text-[10px] text-slate-400"></th>
            {DAYS.map((d) => (
              <th key={d} className="text-xs font-medium text-slate-500">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h) => (
            <tr key={h}>
              <td className="text-[10px] text-slate-400">{h}</td>
              {DAYS.map((d) => {
                const on = selected.has(key(d, h));
                return (
                  <td key={d}>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => toggle(d, h)}
                      className={
                        "slot-cell " +
                        (on
                          ? "bg-brand-500 text-white"
                          : "bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700")
                      }
                      aria-pressed={on}
                      aria-label={`${d}요일 ${h}시`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-400">
        칸을 눌러 가능한 시간을 표시하세요. 아무것도 표시하지 않으면 모든 시간에 가능한 것으로 계산돼요.
      </p>
    </div>
  );
}
