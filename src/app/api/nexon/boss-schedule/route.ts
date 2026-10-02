import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { lookupOuid, fetchRegisteredBossSchedule, NexonApiError } from "@/lib/nexon/client";

// 로그인한 본인이 /profile에서 연동해둔 넥슨 API 키로, 자기 캐릭터(본캐 +
// 부캐 여러 개)의 "인게임 스케줄러"에 실제로 등록해둔 보스 목록(난이도
// 포함)을 가져온다. registration_flag가 true인 것만 돌려준다 -- 그룹 보스
// 명단에 "추가 제안"할 때 쓰는 용도.
//
// ?names=닉네임1,닉네임2,... 로 여러 캐릭터를 한 번에 조회할 수 있다.
// names가 없으면 하위호환을 위해 profile.nexon_character_name 하나만 쓴다.
// 넥슨 오픈 API는 "이 계정에 속한 캐릭터 목록"을 주는 엔드포인트가 없어서
// (순수 공개 데이터 조회용 API 키라 계정 로그인 개념이 없음, src/lib/nexon/client.ts
// 상단 설명 참고) 캐릭터명을 사용자가 직접 입력/관리하는 방식으로 처리한다.
export async function GET(req: NextRequest) {
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

  if (!profile?.nexon_api_key_enc) {
    return NextResponse.json(
      { error: "먼저 프로필에서 넥슨 API 키를 연동해주세요." },
      { status: 400 }
    );
  }

  const namesParam = req.nextUrl.searchParams.get("names");
  const names = namesParam
    ? namesParam
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
    : profile.nexon_character_name
      ? [profile.nexon_character_name]
      : [];

  if (names.length === 0) {
    return NextResponse.json(
      { error: "먼저 프로필에서 넥슨 캐릭터를 연동하거나, 조회할 캐릭터명을 입력해주세요." },
      { status: 400 }
    );
  }

  const apiKey = decryptSecret(profile.nexon_api_key_enc);

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 넥슨 오픈 API는 짧은 시간에 요청이 몰리면 429(OPENAPI00007 "Please try
  // again later")를 돌려준다. 캐릭터 하나당 lookupOuid + scheduler 조회로
  // 호출이 2번씩 나가니, 여러 캐릭터를 Promise.all로 한꺼번에 쏘면 거의 항상
  // 걸린다. 그래서 캐릭터별로 순차 처리하고, 각 캐릭터 사이에 짧은 간격을
  // 두고, 429를 맞으면 한 번 더 기다렸다가 재시도한다.
  type FetchResult = {
    character_name: string;
    world_name: string | null;
    bosses: { name: string; difficulty: string; cycle: string; complete: boolean }[];
    error?: string;
  };

  async function fetchOne(characterName: string): Promise<FetchResult> {
    const attempt = async (): Promise<FetchResult> => {
      const ocid = await lookupOuid(characterName, apiKey);
      await sleep(150); // 같은 캐릭터 안에서도 두 호출 사이에 약간 간격
      const { registered, raw } = await fetchRegisteredBossSchedule(ocid, apiKey);
      return {
        character_name: raw.character_name,
        world_name: raw.world_name,
        bosses: registered.map((b) => ({
          name: b.content_name,
          difficulty: b.difficulty,
          cycle: b.cycle,
          complete: b.complete_flag === "true",
        })),
      };
    };
    try {
      return await attempt();
    } catch (e) {
      if (e instanceof NexonApiError && e.status === 429) {
        await sleep(1500);
        try {
          return await attempt();
        } catch (e2) {
          const message =
            e2 instanceof NexonApiError
              ? "넥슨 API 요청이 너무 잦아요. 잠시 후 다시 시도해주세요."
              : "넥슨 스케줄러 조회 중 오류가 발생했어요.";
          return { character_name: characterName, world_name: null, bosses: [], error: message };
        }
      }
      const message = e instanceof NexonApiError ? e.message : "넥슨 스케줄러 조회 중 오류가 발생했어요.";
      return { character_name: characterName, world_name: null, bosses: [], error: message };
    }
  }

  const results: FetchResult[] = [];
  for (let i = 0; i < names.length; i++) {
    if (i > 0) await sleep(300); // 캐릭터 사이 호출 간격 -- 429 예방
    results.push(await fetchOne(names[i]));
  }

  const allFailed = results.every((r) => r.error);
  if (allFailed) {
    return NextResponse.json(
      { error: results[0]?.error ?? "넥슨 스케줄러 조회 중 오류가 발생했어요.", results },
      { status: 400 }
    );
  }

  // 하위호환: 기존에 단일 캐릭터만 쓰던 호출부를 위해 character_name/bosses
  // 최상위 필드도 함께 내려준다 (첫 번째로 성공한 캐릭터 기준).
  const firstOk = results.find((r) => !r.error);

  return NextResponse.json({
    character_name: firstOk?.character_name ?? names[0],
    world_name: firstOk?.world_name ?? null,
    bosses: firstOk?.bosses ?? [],
    results,
  });
}
