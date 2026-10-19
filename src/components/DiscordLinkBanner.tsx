"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// [추가] 디스코드를 연결하지 않은 사람에게만 스케줄 페이지 상단에 보이는 안내 한 줄.
// 연결하면 사라지고, ×를 누르면 이 브라우저에서는 다시 안 뜬다 (localStorage).
const KEY = "discord-banner-dismissed";

export default function DiscordLinkBanner({ linked }: { linked: boolean }) {
  const [dismissed, setDismissed] = useState(true); // 저장값을 읽기 전에는 숨겨 둔다 (깜빡임 방지)

  useEffect(() => {
    let v = false;
    try {
      v = localStorage.getItem(KEY) === "1";
    } catch {
      // 저장소를 못 쓰면 매번 보여준다
    }
    setDismissed(v);
  }, []);

  if (linked || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // 무시
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-900">
      <span>
        디스코드를 연결하면 파티 알림 멘션을 받을 수 있어요 ·{" "}
        <Link href="/profile" className="font-bold underline">
          프로필에서 연결
        </Link>
      </span>
      <button type="button" onClick={dismiss} aria-label="안내 닫기" className="text-indigo-400 hover:text-indigo-700">
        ×
      </button>
    </div>
  );
}
