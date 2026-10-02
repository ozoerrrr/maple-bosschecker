import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  // 307(기본값)은 리다이렉트할 때도 원래 메서드(POST)를 그대로 유지해서
  // "/login"에 POST로 다시 요청하게 되고, /login은 GET만 받는 페이지라
  // 405가 난다. 303은 리다이렉트 시 항상 GET으로 바뀌므로 이걸 써야 한다.
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
