"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// [추가] 도움말 토글 ("?" 버튼, 레이드 시간표의 help-btn 포팅).
// 켜면 <html>에 help-on 클래스를 붙여 .help-detail 설명을 보이게 한다 (globals.css). 기본은 꺼짐.
// 켜고 끈 상태는 이 브라우저에만 기억한다 (localStorage, 못 쓰면 매번 꺼짐으로 시작).
const KEY = "help-on";

export default function HelpToggle({ projectId }: { projectId: string }) {
  const [on, setOn] = useState(false);
  // [추가] 그룹 이름 옆(공통 레이아웃)에 두지만, 버튼은 스케줄 페이지(/p/[id])에서만 보인다
  const pathname = usePathname();
  const onSchedulePage = pathname === `/p/${projectId}`;

  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(KEY) === "1";
    } catch {
      // 저장소를 못 쓰면 꺼짐
    }
    setOn(saved);
  }, []);

  // 스케줄 페이지가 아니면 help-on도 꺼서 다른 화면에 설명이 남지 않게 한다
  useEffect(() => {
    document.documentElement.classList.toggle("help-on", on && onSchedulePage);
    return () => document.documentElement.classList.remove("help-on");
  }, [on, onSchedulePage]);

  function toggle() {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // 무시
    }
  }

  if (!onSchedulePage) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      className="help-btn"
      aria-label="도움말"
      aria-pressed={on}
      data-tip={on ? "도움말 숨기기" : "도움말 보기"}
    >
      ?
    </button>
  );
}
