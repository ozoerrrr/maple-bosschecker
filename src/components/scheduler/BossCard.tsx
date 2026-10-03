"use client";

import React from "react";
import { BossParty } from "./types";

interface BossCardProps {
  party: BossParty;
  onUpdateTime: (id: string, timeVal: string) => void;
  onToggleClear: (id: string) => void;
}

export const BossCard: React.FC<BossCardProps> = ({
  party,
  onUpdateTime,
  onToggleClear,
}) => {
  const getBadgeStyle = (diff: BossParty["diff"]) => {
    switch (diff) {
      case "Hard":
        return "bg-red-50 text-red-600 border border-red-200/60";
      case "Extreme":
        return "bg-purple-50 text-purple-600 border border-purple-200/60";
      case "Chaos":
        return "bg-amber-50 text-amber-600 border border-amber-200/60";
      case "Normal":
      default:
        return "bg-blue-50 text-blue-600 border border-blue-200/60";
    }
  };

  return (
    <div
      className={`flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 md:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm transition-all duration-200 hover:shadow-md hover:border-slate-300 ${
        party.cleared ? "opacity-60 bg-slate-50/60" : ""
      }`}
    >
      {/* Left: Info */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-2xl flex-shrink-0 shadow-inner">
          {party.icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-base font-bold text-slate-900">{party.name}</h4>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-md ${getBadgeStyle(
                party.diff
              )}`}
            >
              {party.diff}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
            <span>
              파티원:{" "}
              <strong className="text-slate-700 font-semibold">
                {party.members.join(", ")}
              </strong>
            </span>
            <span>•</span>
            <span>{party.members.length}인 파티</span>
          </div>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        <select
          value={party.confirmedTime}
          onChange={(e) => onUpdateTime(party.id, e.target.value)}
          className="text-xs md:text-sm font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 outline-none cursor-pointer hover:border-slate-300 focus:border-orange-500 focus:bg-white transition min-w-[200px]"
        >
          <option value="미확정">미확정 (시간 선택)</option>
          {party.candidates.map((c, idx) => (
            <option key={idx} value={c.label.split(" (")[0]}>
              {c.label}
            </option>
          ))}
        </select>

        {party.cleared ? (
          <button
            onClick={() => onToggleClear(party.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 transition"
          >
            ✓ 완료
          </button>
        ) : (
          <button
            onClick={() => onToggleClear(party.id)}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition shadow-sm"
          >
            완료
          </button>
        )}
      </div>
    </div>
  );
};
