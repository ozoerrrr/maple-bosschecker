import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

// 서버 컴포넌트 / route handler / server action에서 쓰는 Supabase 클라이언트.
// 쿠키에 담긴 세션으로 auth.uid()가 채워지므로 RLS가 "로그인한 그 사람"
// 기준으로 평가된다.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // 서버 컴포넌트에서 호출되면 무시해도 됨 (미들웨어가 세션 갱신을 처리)
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // 위와 동일
          }
        },
      },
    }
  );
}

// 서버 전용 관리자 클라이언트 (service_role). RLS를 우회하므로 넥슨 API 키
// 암복호화 같은, 사용자 본인에게도 원문을 보여주면 안 되는 route handler
// 안에서만 사용한다. 절대 클라이언트 번들에 포함되면 안 됨.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
