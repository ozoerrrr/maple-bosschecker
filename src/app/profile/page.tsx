import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NexonLinkForm from "@/components/NexonLinkForm";

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, nexon_character_name, nexon_world_name")
    .eq("id", user.id)
    .single();

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
      <form action="/auth/signout" method="post">
        <button className="btn-secondary w-full" formAction="/auth/signout">
          로그아웃
        </button>
      </form>
    </main>
  );
}
