import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";
import { verifyAndFetchCharacter, NexonApiError } from "@/lib/nexon/client";

// 로그인한 본인의 넥슨 오픈 API 개인 키 + 캐릭터 닉네임을 받아서:
//  1) 넥슨 API로 실제 존재하는 캐릭터인지 확인하고
//  2) 키는 암호화해서, 캐릭터 정보는 평문으로 profiles에 저장한다.
// 키 원문은 응답에도, 다른 테이블에도 절대 남기지 않는다.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const characterName = typeof body?.characterName === "string" ? body.characterName.trim() : "";

  if (!apiKey || !characterName) {
    return NextResponse.json({ error: "API 키와 캐릭터 닉네임을 모두 입력해주세요." }, { status: 400 });
  }

  try {
    const character = await verifyAndFetchCharacter(characterName, apiKey);

    const { error } = await supabase
      .from("profiles")
      .update({
        nexon_api_key_enc: encryptSecret(apiKey),
        nexon_character_name: character.character_name,
        nexon_world_name: character.world_name,
        nexon_linked_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ character });
  } catch (e) {
    const message = e instanceof NexonApiError ? e.message : "넥슨 API 연동 중 오류가 발생했어요.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const { error } = await supabase
    .from("profiles")
    .update({
      nexon_api_key_enc: null,
      nexon_character_name: null,
      nexon_world_name: null,
      nexon_linked_at: null,
    })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
