import { redirect } from "next/navigation";
import { requireProjectMember } from "@/lib/project";
import BossRosterEditor from "@/components/BossRosterEditor";
import InviteCodeCard from "@/components/InviteCodeCard";
import ImportBossesFromNexon from "@/components/ImportBossesFromNexon";
import DeleteProjectButton from "@/components/DeleteProjectButton";

export default async function ProjectSettingsPage({ params }: { params: { projectId: string } }) {
  const { supabase, user, project, role } = await requireProjectMember(params.projectId);
  if (role !== "owner") redirect(`/p/${params.projectId}`);

  const [{ data: bosses }, { data: parties }, { data: partyMembers }, { data: members }, { data: ownProfile }] =
    await Promise.all([
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
      supabase.from("profiles").select("nexon_character_name").eq("id", user.id).single(),
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
        existingBosses={(bosses ?? []).map((b) => ({ name: b.name, difficulty: b.difficulty }))}
        myCharacterName={ownProfile?.nexon_character_name ?? null}
      />
      <BossRosterEditor projectId={project.id} bosses={bosses ?? []} parties={partyList} members={memberList} />

      <div className="card flex flex-col gap-3">
        <h2 className="font-semibold" style={{ color: "var(--danger)" }}>
          위험 구역
        </h2>
        <p className="sub">그룹을 삭제하면 보스/파티/멤버/가능시간/확정 내역이 모두 사라지고 되돌릴 수 없어요.</p>
        <DeleteProjectButton projectId={project.id} projectName={project.name} />
      </div>
    </div>
  );
}
