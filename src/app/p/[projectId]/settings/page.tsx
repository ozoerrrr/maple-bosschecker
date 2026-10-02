import { redirect } from "next/navigation";
import { requireProjectMember } from "@/lib/project";
import BossRosterEditor from "@/components/BossRosterEditor";
import InviteCodeCard from "@/components/InviteCodeCard";
import ImportBossesFromNexon from "@/components/ImportBossesFromNexon";

export default async function ProjectSettingsPage({ params }: { params: { projectId: string } }) {
  const { supabase, project, role } = await requireProjectMember(params.projectId);
  if (role !== "owner") redirect(`/p/${params.projectId}`);

  const [{ data: bosses }, { data: parties }, { data: partyMembers }, { data: members }] = await Promise.all([
    supabase.from("bosses").select("*").eq("project_id", project.id).order("sort_order"),
    supabase.from("parties").select("*").eq("project_id", project.id).order("sort_order"),
    supabase
      .from("party_members")
      .select("party_id, user_id, parties!inner(project_id)")
      .eq("parties.project_id", project.id),
    supabase
      .from("project_members")
      .select("user_id, role, profiles(display_name)")
      .eq("project_id", project.id),
  ]);

  type MemberRow = { user_id: string; role: string; profiles: { display_name: string } | null };
  const memberList = ((members ?? []) as unknown as MemberRow[]).map((m) => ({
    id: m.user_id,
    name: m.profiles?.display_name ?? "이름없음",
    role: m.role,
  }));

  const partyMembersByParty = new Map<string, string[]>();
  for (const pm of (partyMembers ?? []) as { party_id: string; user_id: string }[]) {
    const arr = partyMembersByParty.get(pm.party_id) ?? [];
    arr.push(pm.user_id);
    partyMembersByParty.set(pm.party_id, arr);
  }
  const partyList = (parties ?? []).map((p) => ({ ...p, members: partyMembersByParty.get(p.id) ?? [] }));

  return (
    <div className="flex flex-col gap-4">
      <InviteCodeCard inviteCode={project.invite_code} members={memberList} />
      <ImportBossesFromNexon
        projectId={project.id}
        existingBossNames={(bosses ?? []).map((b) => b.name)}
      />
      <BossRosterEditor projectId={project.id} bosses={bosses ?? []} parties={partyList} members={memberList} />
    </div>
  );
}
