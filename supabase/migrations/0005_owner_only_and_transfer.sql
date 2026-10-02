-- ============================================================================
-- 설정(보스/파티/파티원/후보 캐릭터) 조작은 그룹장만 가능하도록 강화하고,
-- 그룹장 양도 기능을 추가한다.
--
-- 지금까지 "members can manage ..." 정책들은 is_project_member()라서, 설정
-- 화면 자체는 그룹장한테만 보이지만(settings/page.tsx의 role !== "owner"
-- 리다이렉트), 일반 멤버가 브라우저 콘솔 등으로 Supabase 클라이언트를 직접
-- 호출하면 RLS상으론 막히지 않았다. is_project_owner()로 좁힌다.
--
-- party_confirmations / next_party_confirmations / availability /
-- next_availability / monthly_block 은 그대로 둔다 -- 이건 "그룹 설정"이
-- 아니라 평소에 멤버 각자가 쓰는 기능(내 가능시간, 파티 시간 확정)이라서
-- 그룹장 전용으로 바꾸면 안 된다.
-- ============================================================================

drop policy "members can manage bosses" on public.bosses;
create policy "owner can manage bosses"
  on public.bosses for all
  to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

drop policy "members can manage parties" on public.parties;
create policy "owner can manage parties"
  on public.parties for all
  to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

drop policy "members can manage party rosters" on public.party_members;
create policy "owner can manage party rosters"
  on public.party_members for all
  to authenticated
  using (
    exists (
      select 1 from public.parties p
      where p.id = party_members.party_id and public.is_project_owner(p.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.parties p
      where p.id = party_members.party_id and public.is_project_owner(p.project_id)
    )
  );

drop policy "members can manage boss candidates" on public.boss_candidates;
create policy "owner can manage boss candidates"
  on public.boss_candidates for all
  to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- project_members: 자기 자신의 색상(color) 정도는 여전히 고칠 수 있게 두되,
-- role 컬럼은 컬럼 단위 권한으로 아예 못 건드리게 잠근다 (안 그러면 "member
-- can update their own row" 정책 때문에 멤버가 자기 role을 owner로 직접
-- 바꿔버릴 수 있음 -- RLS using/with check만으론 컬럼 단위 제한이 안 된다).
revoke update on public.project_members from authenticated;
grant update (color) on public.project_members to authenticated;

-- 그룹장 양도: 현재 그룹장만 호출 가능, 대상은 이미 그 그룹 멤버여야 함.
-- security definer(테이블 소유자 권한으로 실행)라서 project_members.role /
-- projects.owner_id를 위 컬럼 권한 제한과 무관하게 원자적으로 같이 바꿀 수 있다.
create or replace function public.transfer_project_ownership(p_project_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_project_owner(p_project_id) then
    raise exception '그룹장만 양도할 수 있어요.';
  end if;
  if p_new_owner_id = auth.uid() then
    raise exception '이미 그룹장이에요.';
  end if;
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_new_owner_id
  ) then
    raise exception '대상이 이 그룹의 멤버가 아니에요.';
  end if;

  update public.project_members set role = 'member'
    where project_id = p_project_id and role = 'owner';
  update public.project_members set role = 'owner'
    where project_id = p_project_id and user_id = p_new_owner_id;
  update public.projects set owner_id = p_new_owner_id
    where id = p_project_id;
end;
$$;

grant execute on function public.transfer_project_ownership(uuid, uuid) to authenticated;
