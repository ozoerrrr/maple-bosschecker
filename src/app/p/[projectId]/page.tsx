import { requireProjectMember } from "@/lib/project";
import ScheduleBoard from "@/components/ScheduleBoard";

export default async function ProjectDashboardPage({ params }: { params: { projectId: string } }) {
  const { supabase, user, project } = await requireProjectMember(params.projectId);
  const projectId = params.projectId;

  const [
    { data: members },
    { data: bosses },
    { data: parties },
    { data: partyMembers },
    { data: availability },
    { data: nextAvailability },
    { data: monthlyBlock },
    { data: confirmations },
    { data: nextConfirmations },
  ] = await Promise.all([
    supabase
      .from("project_members")
      .select("user_id, role, color, profiles(display_name)")
      .eq("project_id", projectId),
    supabase.from("bosses").select("*").eq("project_id", projectId).order("sort_order"),
    supabase.from("parties").select("*").eq("project_id", projectId).order("sort_order"),
    supabase
      .from("party_members")
      .select("party_id, user_id, parties!inner(project_id)")
      .eq("parties.project_id", projectId),
    supabase.from("availability").select("user_id, day, hour").eq("project_id", projectId),
    supabase.from("next_availability").select("user_id, day, hour").eq("project_id", projectId),
    supabase.from("monthly_block").select("user_id, blocked_date").eq("project_id", projectId),
    supabase
      .from("party_confirmations")
      .select("party_id, day, hour, confirmed_date, cleared, parties!inner(project_id)")
      .eq("parties.project_id", projectId),
    supabase
      .from("next_party_confirmations")
      .select("party_id, day, hour, parties!inner(project_id)")
      .eq("parties.project_id", projectId),
  ]);

  type MemberRow = { user_id: string; role: string; color: string | null; profiles: { display_name: string } | null };
  const memberList = ((members ?? []) as unknown as MemberRow[]).map((m) => ({
    id: m.user_id,
    name: m.profiles?.display_name ?? "이름없음",
    color: m.color,
  }));

  const partyMembersByParty = new Map<string, string[]>();
  for (const pm of (partyMembers ?? []) as { party_id: string; user_id: string }[]) {
    const arr = partyMembersByParty.get(pm.party_id) ?? [];
    arr.push(pm.user_id);
    partyMembersByParty.set(pm.party_id, arr);
  }

  const partyList = (parties ?? []).map((p) => ({
    id: p.id,
    boss_id: p.boss_id,
    label: p.label,
    sort_order: p.sort_order,
    members: partyMembersByParty.get(p.id) ?? [],
  }));

  return (
    <ScheduleBoard
      projectId={projectId}
      maxPerHour={project.max_per_hour}
      currentUserId={user.id}
      members={memberList}
      bosses={bosses ?? []}
      parties={partyList}
      availability={availability ?? []}
      nextAvailability={nextAvailability ?? []}
      monthlyBlock={monthlyBlock ?? []}
      confirmations={(confirmations ?? []) as any}
      nextConfirmations={(nextConfirmations ?? []) as any}
    />
  );
}
