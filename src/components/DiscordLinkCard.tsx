"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// [추가] 프로필의 "디스코드 연결" 카드.
// 디스코드 알림에서 나를 멘션하려면 디스코드 사용자 ID가 필요해서, 구글 계정에 디스코드 계정을 "연결"한다
// (로그인은 계속 구글). 연결하면 /auth/callback을 거쳐 프로필로 돌아오고, 프로필 페이지가 연결된
// 디스코드 ID·이름을 profiles.discord_user_id / discord_username에 저장한다.
// 필요 설정: 디스코드 개발자 앱(identify), Supabase Auth의 Discord provider + Manual linking 허용.
export default function DiscordLinkCard({ discordUsername }: { discordUsername: string | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.linkIdentity({
      provider: "discord",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/profile`, scopes: "identify" },
    });
    if (error) {
      setLoading(false);
      setError(`디스코드 연결을 시작하지 못했어요: ${error.message}`);
    }
    // 성공하면 디스코드 로그인 화면으로 이동한다
  }

  async function unlink() {
    setLoading(true);
    setError(null);
    const { data } = await supabase.auth.getUserIdentities();
    const identity = data?.identities.find((i) => i.provider === "discord");
    if (identity) {
      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) {
        setLoading(false);
        setError(`연결 해제에 실패했어요: ${error.message}`);
        return;
      }
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await supabase.from("profiles").update({ discord_user_id: null, discord_username: null }).eq("id", user.id);
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="card flex flex-col gap-3">
      <h2 className="font-semibold">디스코드 연결</h2>
      <p className="label">
        디스코드를 연결하면 그룹의 디스코드 알림(파티 확정·변경, 주간 리셋, 가능 시간 기입)에서 나를 멘션해 줘요.
        로그인은 지금처럼 구글로 하고, 디스코드는 멘션용으로만 연결돼요.
      </p>
      {discordUsername ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">
            연결됨: <strong>{discordUsername}</strong>
          </span>
          <button disabled={loading} onClick={unlink} className="btn-secondary !px-3 !py-1 text-xs">
            연결 해제
          </button>
        </div>
      ) : (
        <button disabled={loading} onClick={link} className="btn-primary self-start">
          {loading ? "이동 중…" : "디스코드 연결"}
        </button>
      )}
      {error && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
