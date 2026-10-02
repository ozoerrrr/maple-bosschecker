import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { lookupOuid, fetchRegisteredBossSchedule, NexonApiError } from "@/lib/nexon/client";

// 로그인한 본인이 /profile에서 연동해둔 넥슨 캐릭터의 "인게임 스케줄러"에
// 실제로 등록해둔 보스 목록(난이도 포함)을 가져온다. registration_flag가
// true인 것만 돌려준다 -- 그룹 보스 명단에 "추가 제안"할 때 쓰는 용도.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("nexon_api_key_enc, nexon_character_name")
    .eq("id", user.id)
    .single();

  if (!profile?.nexon_api_key_enc || !profile.nexon_character_name) {
    return NextResponse.json(
      { error: "먼저 프로필에서 넥슨 캐릭터를 연동해주세요." },
      { status: 400 }
    );
  }

  try {
    const apiKey = decryptSecret(profile.nexon_api_key_enc);
    const ocid = await lookupOuid(profile.nexon_character_name, apiKey);
    const { registered, raw } = await fetchRegisteredBossSchedule(ocid, apiKey);

    return NextResponse.json({
      character_name: raw.character_name,
      world_name: raw.world_name,
      bosses: registered.map((b) => ({
        name: b.content_name,
        difficulty: b.difficulty,
        cycle: b.cycle,
        complete: b.complete_flag === "true",
      })),
    });
  } catch (e) {
    const message = e instanceof NexonApiError ? e.message : "넥슨 스케줄러 조회 중 오류가 발생했어요.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
