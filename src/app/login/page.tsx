"use client";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();

  async function signInWithGoogle() {
    const redirectTo = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
  }

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center text-center px-4">
      <div className="bg-white rounded-3xl border border-[#E2E8F0] shadow-xl p-10 max-w-[440px] w-full">
        {/* 단풍잎 심볼 */}
        <div className="w-16 h-16 bg-gradient-to-br from-[#FF944D] to-[#FF5E1E] rounded-2xl flex items-center justify-center text-white text-3xl shadow-lg shadow-orange-500/30 mx-auto mb-5">
          🍁
        </div>

        <h1 className="text-2xl font-extrabold text-[#1E293B] tracking-tight">
          메이플 레이드 스케줄러
        </h1>
        <p className="text-sm text-[#64748B] mt-2.5 leading-relaxed">
          구글 계정으로 간편하게 로그인하고<br />
          보스 파티 일정을 자동으로 조율해 보세요.
        </p>

        {/* 구글 로그인 버튼 */}
        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 bg-white border border-[#CBD5E1] rounded-xl py-3 px-5 text-sm font-bold text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8] shadow-sm transition-all mt-8 active:scale-95"
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span>구글 계정으로 계속하기</span>
        </button>
      </div>
    </main>
  );
}
