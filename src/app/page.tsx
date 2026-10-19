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

  type Row = {
    project_id: string;
    role: string;
    projects: { id: string; name: string; invite_code: string } | null;
  };

  const projects = ((memberships ?? []) as unknown as Row[])
    .map((m) => (m.projects ? { ...m.projects, role: m.role } : null))
    .filter((p): p is NonNullable<typeof p> => !!p);

  return (
    <main className="flex flex-col gap-6 max-w-4xl mx-auto w-full py-4 font-sans text-slate-800">
      {/* 1. 상단 사용자 헤더 */}
      <header className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xl shadow-md shadow-orange-500/20 flex-shrink-0">
            🍁
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 tracking-tight">
              내 레이드 그룹
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="font-semibold text-slate-700">
                {profile?.display_name ?? user.email}
              </span>
              {profile?.nexon_character_name && (
                <span className="ml-1.5 px-2 py-0.5 rounded-md bg-orange-50 text-orange-600 border border-orange-200 font-medium">
                  {profile.nexon_character_name}
                </span>
              )}
            </p>
          </div>
        </div>
        <Link
          href="/profile"
          className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition shadow-sm"
        >
          👤 내 프로필
        </Link>
      </header>

      {/* 2. 참여 중인 그룹 목록 */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-700">
            참여 중인 그룹 ({projects.length}개)
          </h2>
        </div>

        {projects.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white border border-dashed border-slate-300 text-center">
            <div className="text-3xl mb-2">🏝️</div>
            <p className="text-sm font-semibold text-slate-700">
              아직 속한 레이드 그룹이 없어요.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              아래에서 새로운 그룹을 개설하거나 초대 코드를 입력하여 참여해보세요!
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => {
              const isOwner = p.role === "owner";
              const isManager = p.role === "manager"; // [추가] 0018 부운영자
              return (
                <Link
                  key={p.id}
                  href={`/p/${p.id}`}
                  className="group relative flex flex-col justify-between p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm transition-all duration-200 hover:shadow-md hover:border-orange-400 hover:-translate-y-0.5"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className="font-extrabold text-base text-slate-900 group-hover:text-orange-600 transition">
                      {p.name}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                        isOwner
                          ? "bg-orange-50 text-orange-600 border border-orange-200"
                          : isManager
                          ? "bg-sky-50 text-sky-600 border border-sky-200"
                          : "bg-slate-100 text-slate-600 border border-slate-200"
                      }`}
                    >
                      {isOwner ? "👑 운영자" : isManager ? "부운영자" : "멤버"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs text-slate-500">
                    <span className="font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                      CODE: {p.invite_code}
                    </span>
                    <span className="font-semibold text-orange-500 group-hover:translate-x-1 transition-transform">
                      입장하기 →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. 새 그룹 개설 & 초대코드 참여 폼 */}
      <section className="grid gap-4 sm:grid-cols-2 mt-2">
        <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm">
          <NewProjectForm />
        </div>
        <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm">
          <JoinProjectForm />
        </div>
      </section>
    </main>
  );
}
