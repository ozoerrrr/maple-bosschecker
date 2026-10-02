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
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">레이드 스케줄러</h1>
        <p className="mt-2 text-muted">
          구글 계정으로 로그인하면 그룹을 만들거나 초대코드로 참여할 수 있어요.
        </p>
      </div>
      <button onClick={signInWithGoogle} className="btn-primary">
        구글로 로그인
      </button>
    </main>
  );
}
