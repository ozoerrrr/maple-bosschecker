"use client";

import React, { useState, useEffect } from "react";
import { BossCard } from "./BossCard";
import { AvailabilityModal } from "./AvailabilityModal";
import { BossParty, UserAvailabilityMap } from "./types";

interface RaidSchedulerProps {
  initialMembers?: string[];
  initialParties?: BossParty[];
  initialAvail?: UserAvailabilityMap;
  onSaveToSupabase?: (data: {
    parties: BossParty[];
    avail: UserAvailabilityMap;
  }) => Promise<void>;
}

const DEFAULT_MEMBERS = ["도현", "민재", "상민", "수현", "정민", "재징", "병윤"];

const DEFAULT_PARTIES: BossParty[] = [
  {
    id: "boss-1",
    name: "흉성",
    diff: "Hard",
    diffClass: "diff-hard",
    icon: "⚡",
    members: ["도현", "민재", "상민", "병윤"],
    confirmedTime: "토요일 20:00",
    cleared: false,
    candidates: [
      { label: "토요일 20:00 (전원 가능)", score: 4 },
      { label: "일요일 20:00 (전원 가능)", score: 4 },
      { label: "금요일 21:00 (3명 가능)", score: 3 },
    ],
  },
  {
    id: "boss-2",
    name: "흉성",
    diff: "Normal",
    diffClass: "diff-normal",
    icon: "⚡",
    members: ["수현", "정민", "재징"],
    confirmedTime: "미확정",
    cleared: false,
    candidates: [
      { label: "토요일 20:00 (전원 가능)", score: 3 },
      { label: "일요일 20:00 (전원 가능)", score: 3 },
    ],
  },
  {
    id: "boss-3",
    name: "대적자",
    diff: "Hard",
    diffClass: "diff-hard",
    icon: "⚔️",
    members: ["도현", "상민", "수현", "정민"],
    confirmedTime: "일요일 21:00",
    cleared: true,
    candidates: [
      { label: "일요일 21:00 (전원 가능)", score: 4 },
      { label: "토요일 21:00 (전원 가능)", score: 4 },
    ],
  },
  {
    id: "boss-4",
    name: "대적자",
    diff: "Normal",
    diffClass: "diff-normal",
    icon: "⚔️",
    members: ["민재", "재징", "병윤"],
    confirmedTime: "미확정",
    cleared: false,
    candidates: [
      { label: "토요일 20:00 (전원 가능)", score: 3 },
      { label: "일요일 20:00 (전원 가능)", score: 3 },
    ],
  },
  {
    id: "boss-5",
    name: "칼로스",
    diff: "Chaos",
    diffClass: "diff-chaos",
    icon: "🛡️",
    members: ["도현", "민재", "상민", "수현", "정민", "재징"],
    confirmedTime: "토요일 21:00",
    cleared: false,
    candidates: [
      { label: "토요일 21:00 (전원 가능)", score: 6 },
      { label: "일요일 21:00 (5명 가능)", score: 5 },
    ],
  },
  {
    id: "boss-6",
    name: "카링",
    diff: "Hard",
    diffClass: "diff-hard",
    icon: "🦊",
    members: ["도현", "민재", "상민", "수현", "정민", "재징"],
    confirmedTime: "미확정",
    cleared: false,
    candidates: [
      { label: "토요일 20:00 (전원 가능)", score: 6 },
      { label: "일요일 20:00 (전원 가능)", score: 6 },
    ],
  },
];

const DEFAULT_AVAIL: UserAvailabilityMap = {
  도현: ["금-20", "금-21", "토-14", "토-15", "토-20", "토-21", "일-14", "일-15", "일-20", "일-21"],
  민재: ["금-21", "토-20", "토-21", "일-20", "일-21"],
  상민: ["금-20", "금-21", "토-20", "토-21", "일-20", "일-21"],
  수현: ["토-14", "토-15", "토-20", "토-21", "일-20", "일-21"],
  정민: ["금-21", "토-20", "토-21", "일-20", "일-21"],
  재징: ["토-20", "토-21", "일-20", "일-21"],
  병윤: ["금-20", "금-21", "토-20", "일-20"],
};

export const RaidScheduler: React.FC<RaidSchedulerProps> = ({
  initialMembers = DEFAULT_MEMBERS,
  initialParties = DEFAULT_PARTIES,
  initialAvail = DEFAULT_AVAIL,
  onSaveToSupabase,
}) => {
  const [members] = useState<string[]>(initialMembers);
  const [currentUser, setCurrentUser] = useState<string>(initialMembers[0] || "도현");
  const [parties, setParties] = useState<BossParty[]>(initialParties);
  const [avail, setAvail] = useState<UserAvailabilityMap>(initialAvail);
  const [currentWeekTab, setCurrentWeekTab] = useState<"this" | "next">("this");
  const [hideCleared, setHideCleared] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [countdown, setCountdown] = useState("D-4 00:00:00");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Weekly countdown timer (Thu 00:00 KST)
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const day = now.getDay();
      const diffDays = (4 - day + 7) % 7 || 7;
      const target = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + diffDays,
        0,
        0,
        0
      );
      const diffMs = target.getTime() - now.getTime();
      const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const h = String(Math.floor((diffMs / (1000 * 60 * 60)) % 24)).padStart(2, "0");
      const m = String(Math.floor((diffMs / (1000 * 60)) % 60)).padStart(2, "0");
      const s = String(Math.floor((diffMs / 1000) % 60)).padStart(2, "0");
      setCountdown(`D-${d} ${h}:${m}:${s}`);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleUpdateTime = (id: string, timeVal: string) => {
    setParties((prev) =>
      prev.map((p) => (p.id === id ? { ...p, confirmedTime: timeVal } : p))
    );
    showToast("파티 일정이 갱신되었습니다.");
  };

  const handleToggleClear = (id: string) => {
    setParties((prev) =>
      prev.map((p) => (p.id === id ? { ...p, cleared: !p.cleared } : p))
    );
    showToast("보스 클리어 상태가 변경되었습니다.");
  };

  const handleSaveModalSlots = (newSlots: string[]) => {
    setAvail((prev) => ({
      ...prev,
      [currentUser]: newSlots,
    }));
    showToast(`'${currentUser}' 님의 가능 시간이 저장되었습니다!`);
  };

  const handleResetAll = () => {
    if (window.confirm("정말로 모든 주간 일정을 초기화하시겠습니까?")) {
      setParties((prev) =>
        prev.map((p) => ({ ...p, confirmedTime: "미확정", cleared: false }))
      );
      showToast("모든 주간 일정이 초기화되었습니다.");
    }
  };

  const handleSaveAll = async () => {
    if (onSaveToSupabase) {
      await onSaveToSupabase({ parties, avail });
    }
    showToast("💾 변경사항이 성공적으로 저장되었습니다!");
  };

  const filteredParties = parties.filter((p) => !hideCleared || !p.cleared);
  const userSlots = avail[currentUser] || [];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xl shadow-md shadow-orange-500/20">
              🍁
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
                레이드 스케줄러
                <span className="text-[11px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md">
                  MapleStory
                </span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetAll}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
            >
              🔄 주간 초기화
            </button>
            <button
              onClick={handleSaveAll}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-sm hover:from-orange-600 hover:to-orange-700 transition"
            >
              💾 변경사항 저장
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        {/* Top Summary Banner */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-br from-orange-50/80 to-orange-100/50 border border-orange-200/80 mb-6 shadow-sm">
          <div>
            <h2 className="text-lg font-extrabold text-orange-950 flex items-center gap-2">
              🍁 주간 보스 파티 일정 조율
            </h2>
            <p className="text-xs sm:text-sm text-orange-800/90 mt-1">
              파티원들의 가능 시간을 기반으로 겹치는 최적 시간대를 자동으로 계산하여 추천합니다.
            </p>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto bg-white px-4 py-2.5 rounded-xl border border-orange-200 shadow-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <div>
              <div className="text-[11px] font-semibold text-orange-800">
                주간 리셋 (매주 목요일 00:00)
              </div>
              <div className="text-sm font-bold text-orange-600 font-mono">
                {countdown}
              </div>
            </div>
          </div>
        </section>

        {/* User Quick Bar */}
        <section className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              👤 나는 누구인가요?
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {members.map((name) => {
                const isActive = name === currentUser;
                return (
                  <button
                    key={name}
                    onClick={() => {
                      setCurrentUser(name);
                      showToast(`'${name}' 님으로 선택되었습니다.`);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      isActive
                        ? "bg-orange-50 border border-orange-300 text-orange-700 font-bold shadow-sm"
                        : "bg-slate-100 border border-transparent text-slate-600 hover:bg-slate-200/70"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isActive ? "bg-orange-500" : "bg-slate-400"
                      }`}
                    />
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <span className="text-xs text-slate-500">
              선택된 가능 시간:{" "}
              <strong className="text-orange-600 font-bold">
                {userSlots.length}개
              </strong>
            </span>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 transition shadow-sm"
            >
              🕒 내 가능 시간 설정
            </button>
          </div>
        </section>

        {/* View Controls & Filter Bar */}
        <section className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-xl">
            <button
              onClick={() => setCurrentWeekTab("this")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition ${
                currentWeekTab === "this"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              이번주 레이드
            </button>
            <button
              onClick={() => setCurrentWeekTab("next")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition ${
                currentWeekTab === "next"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              다음주 미리입력
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setHideCleared((prev) => !prev)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                hideCleared
                  ? "bg-slate-800 border-slate-800 text-white"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {hideCleared ? "클리어 표시하기" : "클리어 숨기기"}
            </button>
          </div>
        </section>

        {/* Boss List */}
        <section className="space-y-3 mb-8">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2 mb-2">
            <span>
              주간 보스 파티 현황 (
              {currentWeekTab === "this" ? "이번주" : "다음주 미리입력"})
            </span>
            <div className="h-[1px] flex-1 bg-slate-200" />
          </div>

          {filteredParties.map((party) => (
            <BossCard
              key={party.id}
              party={party}
              onUpdateTime={handleUpdateTime}
              onToggleClear={handleToggleClear}
            />
          ))}
        </section>

        {/* Monthly Boss Section */}
        <section className="space-y-3">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2 mb-2">
            <span>월간 보스 (날짜 지정형)</span>
            <div className="h-[1px] flex-1 bg-slate-200" />
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 md:p-5 rounded-2xl bg-purple-50/70 border border-dashed border-purple-300">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-purple-100 border border-purple-200 flex items-center justify-center text-2xl flex-shrink-0">
                🔮
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-600 text-white">
                    월간
                  </span>
                  <strong className="text-sm font-bold text-purple-950">
                    검은 마법사 (Extreme)
                  </strong>
                </div>
                <div className="text-xs text-purple-700 mt-1">
                  참여 파티원: 도현, 민재, 상민, 수현, 정민, 재징 (6인 풀파티)
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <select className="text-xs md:text-sm font-semibold text-slate-800 bg-white border border-purple-200 rounded-xl px-3.5 py-2 outline-none">
                <option value="10-15">10월 15일(일) 21:00 (전원 가능)</option>
                <option value="10-22">10월 22일(일) 21:00</option>
              </select>
              <button className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white border border-purple-300 text-purple-700 hover:bg-purple-100 transition shadow-sm">
                완료
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Availability Modal */}
      <AvailabilityModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        currentUser={currentUser}
        initialSlots={userSlots}
        onSave={handleSaveModalSlots}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-900 text-white text-xs sm:text-sm font-semibold shadow-2xl animate-in slide-in-from-bottom-5 duration-200">
          <span>✅</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export default RaidScheduler;
