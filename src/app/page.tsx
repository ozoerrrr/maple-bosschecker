import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewProjectForm from "@/components/NewProjectForm";
import JoinProjectForm from "@/components/JoinProjectForm";

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, nexon_character_name")
    .eq("id", user.id)
    .single();

  const { data: memberships } = await supabase
    .from("project_members")
    .select("project_id, role, projects(id, name, invite_code)")
    .eq("user_id", user.id);

  type Row = { project_id: string; role: string; projects: { id: string; name: string; invite_code: string } | null };
  const projects = ((memberships ?? []) as unknown as Row[])
    .map((m) => (m.projects ? { ...m.projects, role: m.role } : null))
    .filter((p): p is NonNullable<typeof p> => !!p);

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">내 그룹</h1>
          <p className="text-muted">
            {profile?.display_name ?? user.email}
            {profile?.nexon_character_name ? ` · ${profile.nexon_character_name}` : ""}
          </p>
        </div>
        <Link href="/profile" className="btn-secondary">
          프로필
        </Link>
      </header>

      <section className="flex flex-col gap-2">
        {projects.length === 0 && (
          <p className="card text-muted">
            아직 속한 그룹이 없어요. 아래에서 새로 만들거나 초대코드로 참여해보세요.
          </p>
        )}
        {projects.map((p) => (
          <Link key={p.id} href={`/p/${p.id}`} className="card flex items-center justify-between hover:border-[color:var(--accent)]">
            <span className="font-medium">{p.name}</span>
            <span className="text-muted text-xs">{p.role === "owner" ? "운영자" : "멤버"}</span>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <NewProjectForm />
        <JoinProjectForm />
      </section>
    </main>
  );
}
