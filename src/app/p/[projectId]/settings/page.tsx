import { redirect } from "next/navigation";
import { requireProjectMember } from "@/lib/project";
import BossRosterEditor from "@/components/BossRosterEditor";
import { splitRosters } from "@/lib/scheduling/snapshot";
import InviteCodeCard from "@/components/InviteCodeCard";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import TransferOwnershipButton from "@/components/TransferOwnershipButton";
import DiscordNotificationSettings from "@/components/DiscordNotificationSettings";

export default async function ProjectSettingsPage({ params }: { params: { projectId: string } }) {
  const { supabase, user, project, role } = await requireProjectMember(params.projectId);
  if (role !== "owner") redirect(`/p/${params.projectId}`);

  const [
    { data: bosses },
    { data: parties },
    { data: partyMembers },
    { data: members },
    { data: bossCandidates },
    { data: extraChars },
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
    supabase.from("boss_candidates").select("*").eq("project_id", project.id),
    // [추가] 파티 추가·수정 폼의 캐릭터 목록용: 캐릭터별 메소 카드에서 직접 추가한 캐릭터 (0011)
    supabase.from("extra_characters").select("user_id, character_name").eq("project_id", project.id),
  ]);

  type MemberRow = { user_id: string; role: string };
  const memberRows = (members ?? []) as MemberRow[];
  const memberIds = memberRows.map((m) => m.user_id);
  const { data: memberProfiles } = memberIds.length
    ? await supabase.from("profiles").select("id, display_name, nexon_character_name, discord_user_id").in("id", memberIds)
    : { data: [] as { id: string; display_name: string; nexon_character_name: string | null; discord_user_id: string | null }[] };
  // [추가] 디스코드 연결 여부 (멤버 목록의 "디코 미연동" 표시)
  const discordLinkedById = new Map((memberProfiles ?? []).map((p) => [p.id, !!p.discord_user_id]));
  // [추가] 디스코드 알림 설정 (0016, 그룹장만 읽기)
  const { data: notifySettings } = await supabase
    .from("project_notifications")
    .select("webhook_url, notify_confirm, notify_change, notify_reset, notify_avail, avail_dow, avail_hour")
    .eq("project_id", project.id)
    .maybeSingle();
  const profileNameById = new Map((memberProfiles ?? []).map((p) => [p.id, p.display_name]));
  const memberList = memberRows.map((m) => ({
    id: m.user_id,
    name: profileNameById.get(m.user_id) ?? "이름없음",
    role: m.role,
    discordLinked: discordLinkedById.get(m.user_id) ?? false, // [추가]
  }));

  const partyMembersByParty = new Map<string, { userId: string; characterName: string | null }[]>();
  for (const pm of (partyMembers ?? []) as { party_id: string; user_id: string; character_name: string | null }[]) {
    const arr = partyMembersByParty.get(pm.party_id) ?? [];
    arr.push({ userId: pm.user_id, characterName: pm.character_name });
    partyMembersByParty.set(pm.party_id, arr);
  }
  const partyList = (parties ?? []).map((p) => ({ ...p, members: partyMembersByParty.get(p.id) ?? [] }));
  // [추가] 0017: 보스 목록의 [이번주 | 다음주] 토글용으로 나눈다
  const { thisParties, nextParties } = splitRosters(bosses ?? [], partyList);

  // boss_candidates에는 user_id만 있고 표시용 이름은 없어서, 멤버 목록
  // (memberList)에서 JS로 합친다 -- 위 party_members/profiles와 같은 패턴.
  const candidateList = (bossCandidates ?? []).map((c) => ({
    id: c.id,
    bossId: c.boss_id,
    userId: c.user_id,
    characterName: c.character_name,
    memberName: profileNameById.get(c.user_id) ?? "이름없음",
  }));

  // [추가] 그룹원별 캐릭터 목록 (파티 추가·수정 폼에서 고를 캐릭터).
  // 웹에는 "캐릭터 목록" 테이블이 따로 없어서 이미 있는 데이터를 사람별로 합친다:
  // 넥슨에서 불러온 후보 캐릭터 + 이미 파티에 들어간 캐릭터 + 직접 추가한 캐릭터 + 프로필의 넥슨 대표 캐릭터
  const charKeys = new Set<string>();
  const memberChars: { userId: string; characterName: string }[] = [];
  const addChar = (userId: string, name: string | null | undefined) => {
    const n = (name ?? "").trim();
    if (!n || !memberIds.includes(userId) || charKeys.has(`${userId}|${n}`)) return;
    charKeys.add(`${userId}|${n}`);
    memberChars.push({ userId, characterName: n });
  };
  for (const c of bossCandidates ?? []) addChar(c.user_id, c.character_name);
  for (const pm of (partyMembers ?? []) as { user_id: string; character_name: string | null }[]) addChar(pm.user_id, pm.character_name);
  for (const e of extraChars ?? []) addChar(e.user_id, e.character_name);
  for (const p of memberProfiles ?? []) addChar(p.id, p.nexon_character_name);

  return (
    <div className="flex flex-col gap-4">
      <InviteCodeCard inviteCode={project.invite_code} members={memberList} />
      <BossRosterEditor
        projectId={project.id}
        bosses={bosses ?? []}
        parties={thisParties} // [변경] 0017: 이번주 파티
        nextParties={nextParties} // [추가] 0017: 다음주에 보일 파티
        members={memberList}
        candidates={candidateList}
        memberChars={memberChars} // [추가]
      />
      {/* [추가] 디스코드 알림 설정 (그룹장 전용 화면) */}
      <DiscordNotificationSettings projectId={project.id} initial={notifySettings ?? null} />

      <div className="card flex flex-col gap-3">
        <h2 className="font-semibold" style={{ color: "var(--danger)" }}>
          위험 구역
        </h2>
        <p className="sub">그룹을 삭제하면 보스/파티/멤버/가능시간/확정 내역이 모두 사라지고 되돌릴 수 없어요.</p>
        <DeleteProjectButton projectId={project.id} projectName={project.name} />
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.25rem" }}>
          <TransferOwnershipButton
            projectId={project.id}
            members={memberList.filter((m) => m.id !== user.id)}
          />
        </div>
      </div>
    </div>
  );
}
