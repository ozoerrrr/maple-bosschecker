import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import "./globals.css";

// [추가] 메이플스토리 폰트 (레이드 시간표와 같은 글꼴).
// Light=300, Bold=700 두 파일만 등록하면 브라우저가 굵기 400~500은 Light, 600 이상은 Bold로 그린다.
const maplestory = localFont({
  src: [
    { path: "./fonts/Maplestory-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Maplestory-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-maple",
  display: "swap",
});

export const metadata: Metadata = {
  title: "메이플스토리 보스 레이드 스케줄러",
  description: "그룹별로 보스 파티 시간을 맞추는 스케줄링 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={maplestory.variable}>
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
            {/* [추가] 오른쪽 버튼 자리: 그룹 화면이 새로고침·도움말 버튼을 여기에 그린다 (HeaderActions 포털) */}
            <div id="site-header-actions" className="flex items-center gap-2" />
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
