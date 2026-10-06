import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "메이플스토리 보스 레이드 스케줄러",
  description: "그룹별로 보스 파티 시간을 맞추는 스케줄링 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen flex flex-col bg-[#F6F8FB] text-[#1E293B]">
        {/* Top Navigation Bar */}
        <header className="bg-white/95 border-b border-[#E2E8F0] sticky top-0 z-40 backdrop-blur-md">
          <div className="max-w-[1080px] mx-auto px-6 py-3 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-3 no-underline">
              <div className="w-9 h-9 bg-gradient-to-br from-[#FF944D] to-[#FF5E1E] rounded-xl flex items-center justify-center text-white text-xl shadow-md shadow-orange-500/20">
                🍁
              </div>
              <div className="text-lg font-extrabold tracking-tight text-[#1E293B] flex items-center gap-2">
                레이드 스케줄러
                <span className="text-xs font-semibold text-[#FF7B29] bg-[#FFF2E8] px-2 py-0.5 rounded-md">
                  MapleStory
                </span>
              </div>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <div className="max-w-[1080px] w-full mx-auto px-6 py-6 flex-1">
          {children}
        </div>
      </body>
    </html>
  );
}
