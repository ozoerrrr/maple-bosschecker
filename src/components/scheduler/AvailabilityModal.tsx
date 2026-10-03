"use client";

import React, { useState, useEffect } from "react";

interface AvailabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: string;
  initialSlots: string[];
  onSave: (slots: string[]) => void;
}

const DAYS = ["목", "금", "토", "일", "월", "화", "수"];
const SLOTS = ["14", "15", "19", "20", "21", "22"];

export const AvailabilityModal: React.FC<AvailabilityModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  initialSlots,
  onSave,
}) => {
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      setSelectedSlots(new Set(initialSlots));
    }
  }, [isOpen, initialSlots]);

  if (!isOpen) return null;

  const toggleSlot = (key: string) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllWeekendNight = () => {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      ["토-20", "토-21", "토-22", "일-20", "일-21", "일-22"].forEach((slot) =>
        next.add(slot)
      );
      return next;
    });
  };

  const clearAllSlots = () => {
    setSelectedSlots(new Set());
  };

  const handleConfirm = () => {
    onSave(Array.from(selectedSlots));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 transition-all duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 bg-gradient-to-b from-white to-slate-50/70">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span>🕒</span>
            <span>
              내 가능 시간 설정 (
              <span className="text-orange-500">{currentUser}</span>)
            </span>
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto">
          {/* Quick Helper Box */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 mb-5 rounded-xl bg-orange-50 border border-orange-200/70 text-sm text-orange-950">
            <span>클릭하여 가능한 시간대를 선택하세요. 파티원 시간과 자동 조합됩니다.</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllWeekendNight}
                className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white border border-orange-200 text-orange-700 hover:bg-orange-100/60 shadow-sm transition"
              >
                주말 저녁 일괄
              </button>
              <button
                type="button"
                onClick={clearAllSlots}
                className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 shadow-sm transition"
              >
                전체 해제
              </button>
            </div>
          </div>

          {/* Matrix Grid */}
          <div className="grid grid-cols-7 gap-2 select-none">
            {DAYS.map((day) => {
              const isWeekend = day === "토" || day === "일";
              return (
                <div key={day} className="flex flex-col gap-2">
                  <div
                    className={`py-1.5 text-center text-xs font-bold rounded-lg ${
                      isWeekend
                        ? "bg-red-50 text-red-500"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {day}
                  </div>
                  {SLOTS.map((hour) => {
                    const key = `${day}-${hour}`;
                    const isSelected = selectedSlots.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleSlot(key)}
                        className={`py-2 px-1 text-xs font-semibold rounded-lg border transition-all text-center ${
                          isSelected
                            ? "bg-orange-50 border-orange-500 text-orange-700 shadow-sm font-bold ring-1 ring-orange-400"
                            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        {hour}:00
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md hover:from-orange-600 hover:to-orange-700 transition"
          >
            확인 및 적용
          </button>
        </div>
      </div>
    </div>
  );
};
