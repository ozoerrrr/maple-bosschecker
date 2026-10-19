// [추가] 파티 클리어 저장 공통 함수 -- 메소 카드의 파티 보스 클리어 체크와 넥슨 불러오기(인게임 완료 여부)가 같이 쓴다.
// 스케줄 보스 목록의 "클리어 ✓"(PartyCard)와 같은 party_confirmations 행을 바꾸므로, 어디서 바꿔도 양쪽에 같이 보인다.
//  - 클리어: 확정 행이 있으면 cleared만 true로, 없으면 시간 없이 바로 클리어(즉석 클리어)로 넣는다
//  - 클리어 취소: 즉석 클리어(시간 없음)면 행을 지워 미확정으로, 시간이 있으면 cleared만 false로
import type { createClient } from "@/lib/supabase/client";
import type { Confirmation } from "./types";

type Client = ReturnType<typeof createClient>;

export async function setPartyCleared(
  supabase: Client,
  partyId: string,
  current: Confirmation | undefined,
  on: boolean,
  userId: string
) {
  if (on) {
    if (current) {
      await supabase.from("party_confirmations").update({ cleared: true }).eq("party_id", partyId);
    } else {
      await supabase.from("party_confirmations").upsert({
        party_id: partyId,
        day: null,
        hour: null,
        confirmed_date: null,
        cleared: true,
        confirmed_by: userId,
      });
    }
    return;
  }
  if (!current) return;
  const isInstant = current.day == null && current.confirmed_date == null;
  if (isInstant) await supabase.from("party_confirmations").delete().eq("party_id", partyId);
  else await supabase.from("party_confirmations").update({ cleared: false }).eq("party_id", partyId);
}
