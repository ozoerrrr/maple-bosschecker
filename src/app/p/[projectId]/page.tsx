import { requireProjectMember } from "@/lib/project";
import ScheduleBoard from "@/components/ScheduleBoard";

export default async function ProjectDashboardPage({ params }: { params: { projectId: string } }) {
  const { supabase, user, project, role } = await requireProjectMember(params.projectId);
  const projectId = params.projectId;

  // [추가] 주간 리셋: 이번주(한국시간 목요일 시작)에 처음 열릴 때 한 번만
  // 지난주 확정을 지우고 다음주 입력을 이번주로 옮긴다. 판단·처리는 DB 함수(0010)가 하고,
  // 이미 처리된 주면 아무것도 하지 않는다. 실패해도(함수 미설치 등) 화면은 그대로 보여준다.
  await supabase.rpc("apply_weekly_reset", { p_project_id: projectId });

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
    { data: ownProfile },
    { data: bossCandidates },
    { data: soloPlans },
    { data: soloClears },
    { data: extraChars },
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
    supabase.from("profiles").select("nexon_character_name").eq("id", user.id).single(),
    // 후보 등록(boss_candidates)은 이제 그룹장 전용이 아니라 멤버 누구나 자기
    // 캐릭터 몫을 올릴 수 있어서, 메인 스케줄 화면에서도 보여준다.
    supabase.from("boss_candidates").select("*").eq("project_id", projectId),
    // [추가] 캐릭터별 메소·솔로 보스 카드용 (0011)
    supabase
      .from("solo_plans")
      .select("user_id, character_name, boss_name, difficulty, party_size, week")
      .eq("project_id", projectId),
    supabase.from("solo_clears").select("user_id, character_name, boss_name, period_key").eq("project_id", projectId),
    supabase.from("extra_characters").select("user_id, character_name").eq("project_id", projectId),
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

  // boss_candidates에는 user_id만 있고 표시용 이름은 없어서, 위에서 만든
  // profileNameById로 JS에서 합친다 (settings/page.tsx와 동일 패턴).
  const candidateList = (bossCandidates ?? []).map((c) => ({
    id: c.id,
    bossId: c.boss_id,
    userId: c.user_id,
    characterName: c.character_name,
    memberName: profileNameById.get(c.user_id) ?? "이름없음",
  }));

  return (
    <ScheduleBoard
      projectId={projectId}
      maxPerHour={project.max_per_hour}
      currentUserId={user.id}
      // [추가] 그룹장은 자기 그룹의 모든 파티 일정을 확정·완료·해제할 수 있다
      isOwner={role === "owner"}
      members={memberList}
      bosses={bosses ?? []}
      parties={partyList}
      availability={availability ?? []}
      nextAvailability={nextAvailability ?? []}
      monthlyBlock={monthlyBlock ?? []}
      confirmations={(confirmations ?? []) as any}
      nextConfirmations={(nextConfirmations ?? []) as any}
      myCharacterName={ownProfile?.nexon_character_name ?? null}
      candidates={candidateList}
      soloPlans={(soloPlans ?? []) as any} // [추가]
      soloClears={soloClears ?? []} // [추가]
      extraChars={extraChars ?? []} // [추가]
    />
  );
}
