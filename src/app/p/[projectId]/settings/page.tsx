import { redirect } from "next/navigation";
import { requireProjectMember } from "@/lib/project";
import BossRosterEditor from "@/components/BossRosterEditor";
import InviteCodeCard from "@/components/InviteCodeCard";
import ImportBossesFromNexon from "@/components/ImportBossesFromNexon";
import DeleteProjectButton from "@/components/DeleteProjectButton";

export default async function ProjectSettingsPage({ params }: { params: { projectId: string } }) {
  const { supabase, user, project, role } = await requireProjectMember(params.projectId);
  if (role !== "owner") redirect(`/p/${params.projectId}`);

  const [
    { data: bosses },
    { data: parties },
    { data: partyMembers },
    { data: members },
    { data: ownProfile },
    { data: bossCandidates },
  ] = await Promise.all([
    supabase.from("bosses").select("*").eq("project_id", project.id).order("sort_order"),
    supabase.from("parties").select("*").eq("project_id", project.id).order("sort_order"),
    supabase
      .from("party_members")
      .select("party_id, user_id, character_name, parties!inner(project_id)")
      .eq("parties.project_id", project.id),
    // [고침] project_members -> profiles 실제 FK가 없어 임베드가 조용히
    // 빈 결과를 내던 문제 (아래에서 profiles를 따로 불러와 JS로 합침).
    supabase.from("project_members").select("user_id, role").eq("project_id", project.id),
    supabase.from("profiles").select("nexon_character_name").eq("id", user.id).single(),
    supabase.from("boss_candidates").select("*").eq("project_id", project.id),
  ]);

  type MemberRow = { user_id: string; role: string };
  const memberRows = (members ?? []) as MemberRow[];
  const memberIds = memberRows.map((m) => m.user_id);
  const { data: memberProfiles } = memberIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", memberIds)
    : { data: [] as { id: string; display_name: string }[] };
  const profileNameById = new Map((memberProfiles ?? []).map((p) => [p.id, p.display_name]));
  const memberList = memberRows.map((m) => ({
    id: m.user_id,
    name: profileNameById.get(m.user_id) ?? "이름없음",
    role: m.role,
  }));

  const partyMembersByParty = new Map<string, { userId: string; characterName: string | null }[]>();
  for (const pm of (partyMembers ?? []) as { party_id: string; user_id: string; character_name: string | null }[]) {
    const arr = partyMembersByParty.get(pm.party_id) ?? [];
    arr.push({ userId: pm.user_id, characterName: pm.character_name });
    partyMembersByParty.set(pm.party_id, arr);
  }
  const partyList = (parties ?? []).map((p) => ({ ...p, members: partyMembersByParty.get(p.id) ?? [] }));

  // boss_candidates에는 user_id만 있고 표시용 이름은 없어서, 멤버 목록
  // (memberList)에서 JS로 합친다 -- 위 party_members/profiles와 같은 패턴.
  const candidateList = (bossCandidates ?? []).map((c) => ({
    id: c.id,
    bossId: c.boss_id,
    userId: c.user_id,
    characterName: c.character_name,
    memberName: profileNameById.get(c.user_id) ?? "이름없음",
  }));

  return (
    <div className="flex flex-col gap-4">
      <InviteCodeCard inviteCode={project.invite_code} members={memberList} />
      <ImportBossesFromNexon
        projectId={project.id}
        existingBosses={(bosses ?? []).map((b) => ({ name: b.name, difficulty: b.difficulty }))}
        myCharacterName={ownProfile?.nexon_character_name ?? null}
        members={memberList}
        currentUserId={user.id}
      />
      <BossRosterEditor
        projectId={project.id}
        bosses={bosses ?? []}
        parties={partyList}
        members={memberList}
        candidates={candidateList}
      />

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
