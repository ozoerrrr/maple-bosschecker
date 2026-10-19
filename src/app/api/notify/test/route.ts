import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// [추가] 디스코드 알림 "테스트 메시지" (그룹 관리). 웹후크 주소가 브라우저 요청에 드러나지 않도록 서버에서 보낸다.
// project_notifications는 RLS로 그룹장만 읽을 수 있어서, 그룹장이 아니면 주소를 못 찾아 실패한다.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  if (!projectId) return NextResponse.json({ error: "그룹 정보가 없어요." }, { status: 400 });

  const [{ data: setting }, { data: project }] = await Promise.all([
    supabase.from("project_notifications").select("webhook_url").eq("project_id", projectId).maybeSingle(),
    supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
  ]);
  const url = setting?.webhook_url;
  if (!url) return NextResponse.json({ error: "저장된 웹후크 주소가 없어요. 먼저 저장해 주세요." }, { status: 400 });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `[${project?.name ?? "그룹"}] 🔔 레이드 스케줄러 알림 테스트예요. 이 채널로 알림이 와요!`,
      allowed_mentions: { parse: [] },
    }),
  });
  if (!res.ok) return NextResponse.json({ error: `디스코드가 거절했어요 (${res.status}). 웹후크 주소를 확인해 주세요.` }, { status: 400 });
  return NextResponse.json({ ok: true });
}
