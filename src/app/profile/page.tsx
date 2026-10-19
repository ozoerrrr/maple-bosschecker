import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NexonLinkForm from "@/components/NexonLinkForm";
import DiscordLinkCard from "@/components/DiscordLinkCard";

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, nexon_character_name, nexon_world_name, discord_user_id, discord_username")
    .eq("id", user.id)
    .single();

  // [추가] 구글 계정에 연결된 디스코드 계정이 있으면 그 ID·이름을 profiles에 맞춰 둔다 (디스코드 알림 멘션용).
  // 디스코드 연결 버튼 -> 디스코드 로그인 -> /auth/callback -> 이 페이지로 돌아오면서 저장된다.
  const discord = user.identities?.find((i) => i.provider === "discord");
  const meta = (discord?.identity_data ?? {}) as Record<string, unknown>;
  const claims = (meta.custom_claims ?? {}) as Record<string, unknown>;
  const discordId = discord ? String(meta.provider_id ?? meta.sub ?? discord.id) : null;
  const discordName = discord
    ? String(claims.global_name ?? meta.full_name ?? meta.name ?? meta.user_name ?? "디스코드 계정")
    : null;
  if ((profile?.discord_user_id ?? null) !== discordId || (profile?.discord_username ?? null) !== discordName) {
    await supabase.from("profiles").update({ discord_user_id: discordId, discord_username: discordName }).eq("id", user.id);
  }

  return (
    <main className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">프로필</h1>
        <Link href="/" className="btn-secondary">
          그룹 목록
        </Link>
      </div>
      <div className="card">
        <p className="text-muted">이름</p>
        <p className="font-medium">{profile?.display_name ?? user.email}</p>
      </div>
      <NexonLinkForm
        linkedCharacterName={profile?.nexon_character_name ?? null}
        linkedWorldName={profile?.nexon_world_name ?? null}
      />
      <DiscordLinkCard discordUsername={discordName} /> {/* [추가] 디스코드 알림 멘션용 연결 */}
      <form action="/auth/signout" method="post">
        <button className="btn-secondary w-full" formAction="/auth/signout">
          로그아웃
        </button>
      </form>
    </main>
  );
}
