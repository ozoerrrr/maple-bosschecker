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
    // [고침] project_members -> profiles는 실제 FK가 없어서(둘 다 auth.users를
    // 각자 따로 참조할 뿐) PostgREST가 "profiles(display_name)" 임베드를
    // 해석하지 못해 조용히 빈 결과를 돌려주고 있었다 (멤버가 0명으로 보이던
    // 원인). FK를 새로 만드는 대신, profiles는 아래에서 user_id로 따로 불러와
    // JS에서 직접 합친다.
    supabase.from("project_members").select("user_id, role, color").eq("project_id", projectId),
    supabase.from("bosses").select("*").eq("project_id", projectId).order("sort_order"),
    supabase.from("parties").select("*").eq("project_id", projectId).order("sort_order"),
    supabase
      .from("party_members")
      .select("party_id, user_id, character_name, parties!inner(project_id)")
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

  type MemberRow = { user_id: string; role: string; color: string | null };
  const memberRows = (members ?? []) as MemberRow[];
  const memberIds = memberRows.map((m) => m.user_id);
  const { data: memberProfiles } = memberIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", memberIds)
    : { data: [] as { id: string; display_name: string }[] };
  const profileNameById = new Map((memberProfiles ?? []).map((p) => [p.id, p.display_name]));
  const memberList = memberRows.map((m) => ({
    id: m.user_id,
    name: profileNameById.get(m.user_id) ?? "이름없음",
    color: m.color,
  }));

  const partyMembersByParty = new Map<string, { userId: string; characterName: string | null }[]>();
  for (const pm of (partyMembers ?? []) as { party_id: string; user_id: string; character_name: string | null }[]) {
    const arr = partyMembersByParty.get(pm.party_id) ?? [];
    arr.push({ userId: pm.user_id, characterName: pm.character_name });
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
