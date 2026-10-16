"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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

interface DragCell {
  day: Day;
  hour: number;
  on: boolean;
}

// 원본의 "요일로 보기" 그리드(요일 x 24시간 토글). 칸을 누르면 즉시
// Supabase에 upsert/delete 한다 (원본은 로컬 STATE만 바꾸고 "변경사항 저장"
// 버튼을 눌러야 공유됐지만, 여기선 그룹원들이 실시간으로 DB를 보므로 매
// 조작이 바로 반영되는 쪽이 더 자연스럽다).
//
// 캘린더 앱처럼 눌러서 끌면(click-and-drag) 지나간 칸 전부를 같은 상태로
// 바꿀 수 있다: mousedown/touchstart 한 칸의 "반대 상태"를 드래그 모드로
// 기억해두고, 드래그 중 지나간 칸마다 로컬 상태만 즉시 반영하다가, 드래그가
// 끝나는 시점(mouseup/touchend)에 지나간 칸들을 한 번에 모아 upsert 1회 +
// delete 1회로 커밋한다. 움직임 없는 단순 클릭은 드래그 칸 집합이 1개뿐인
// 드래그와 동일하게 처리되므로, mouseup 즉시 그 한 칸만 커밋된다(= 기존
// "클릭하면 바로 토글"과 동일한 체감).
export default function AvailabilityGrid({ projectId, userId, weekMode, initialSlots, onSaved }: Props) {
  const supabase = createClient();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSlots.map((s) => key(s.day as Day, s.hour)))
  );

  const table = weekMode === "this" ? "availability" : "next_availability";

  const isDraggingRef = useRef(false);
  const dragModeRef = useRef(true);
  const dragCellsRef = useRef<Map<string, DragCell>>(new Map());

  const applyCell = useCallback((day: Day, hour: number, on: boolean) => {
    const k = key(day, hour);
    dragCellsRef.current.set(k, { day, hour, on });
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
  }, []);

  const commitDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const cells = [...dragCellsRef.current.values()];
    dragCellsRef.current = new Map();
    if (cells.length === 0) return;

    const toAdd = cells.filter((c) => c.on);
    const toRemove = cells.filter((c) => !c.on);

    startTransition(async () => {
      if (toAdd.length > 0) {
        await supabase
          .from(table)
          .upsert(toAdd.map((c) => ({ project_id: projectId, user_id: userId, day: c.day, hour: c.hour })));
      }
      if (toRemove.length > 0) {
        const orFilter = toRemove.map((c) => `and(day.eq.${c.day},hour.eq.${c.hour})`).join(",");
        await supabase
          .from(table)
          .delete()
          .eq("project_id", projectId)
          .eq("user_id", userId)
          .or(orFilter);
      }
      onSaved();
    });
  }, [onSaved, projectId, startTransition, supabase, table, userId]);

  useEffect(() => {
    function onUp() {
      commitDrag();
    }
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, [commitDrag]);

  function startDrag(day: Day, hour: number) {
    const current = selected.has(key(day, hour));
    const mode = !current;
    isDraggingRef.current = true;
    dragModeRef.current = mode;
    dragCellsRef.current = new Map();
    applyCell(day, hour, mode);
  }

  function dragOver(day: Day, hour: number) {
    if (!isDraggingRef.current) return;
    const k = key(day, hour);
    if (dragCellsRef.current.has(k)) return;
    applyCell(day, hour, dragModeRef.current);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!isDraggingRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
    const target = el?.closest<HTMLElement>("[data-day][data-hour]");
    if (!target) return;
    const day = target.dataset.day as Day;
    const hour = Number(target.dataset.hour);
    dragOver(day, hour);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[2px] text-center select-none">
        <thead>
          <tr>
            <th className="w-7 text-[10px]" style={{ color: "var(--muted)" }}></th>
            {DAYS.map((d) => (
              <th key={d} className="text-xs font-bold" style={{ color: "var(--muted)" }}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h) => (
            <tr key={h}>
              {/* [변경] 시간 숫자를 칸 높이에 맞춰 세로 가운데 정렬 */}
              <td className="text-[10px] align-middle" style={{ color: "var(--muted)" }}>
                {h}
              </td>
              {DAYS.map((d) => {
                const on = selected.has(key(d, h));
                return (
                  <td key={d}>
                    <button
                      type="button"
                      disabled={isPending}
                      data-day={d}
                      data-hour={h}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        startDrag(d, h);
                      }}
                      onMouseEnter={() => dragOver(d, h)}
                      onTouchStart={() => startDrag(d, h)}
                      onTouchMove={handleTouchMove}
                      className={"slot-cell" + (on ? " on" : "")}
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
      <p className="sub mt-2">
        칸을 누르거나 눌러서 끌면 가능한 시간을 표시/해제할 수 있어요. 아무것도 표시하지 않으면 모든 시간에 가능한
        것으로 계산돼요.
      </p>
    </div>
  );
}
