import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** 로그인 + 해당 프로젝트 멤버인지 확인하고, 아니면 리다이렉트/404. */
export async function requireProjectMember(projectId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (!project) notFound();

  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) notFound();

  return { supabase, user, project, role: membership.role as "owner" | "manager" | "member" }; // [변경] 0018: 부운영자(manager) 추가
}
