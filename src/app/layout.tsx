import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "레이드 스케줄러",
  description: "그룹별로 보스 파티 시간을 맞추는 스케줄링 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="mx-auto min-h-screen max-w-3xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
