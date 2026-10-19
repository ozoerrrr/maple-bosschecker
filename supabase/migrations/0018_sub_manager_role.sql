-- 0018: 부운영자(manager) 직책
--
-- [추가 이유]
-- 운영자(owner)와 멤버(member) 사이에 "부운영자"(role = 'manager')를 둔다.
-- 부운영자가 할 수 있는 것 (운영자도 모두 가능):
--   - 그룹 관리 페이지의 보스 목록에서 파티 추가·수정·삭제, 파티원 넣고 빼기 (이번주·다음주)
--   - 파티를 추가할 때 보스 카드 자동 생성 (bosses insert)
--   - 모든 파티의 시간 확정·클리어 (can_edit_party_schedule)
--   - 다른 사람 캐릭터를 후보로 되돌리기 (파티원 빼기 때)
-- 운영자만 할 수 있는 것: 보스 수정·삭제, 직책 지정(set_member_role), 디스코드 알림, 운영자 양도, 그룹 삭제.
-- 화면의 직책별 권한 표는 기능명세서 "인증·그룹 관리 → 직책별 권한"에 있다.
-- 여러 번 실행해도 안전하다.

-- 직책 값에 manager 추가 (0001의 이름 없는 check 제약을 찾아 바꾼다)
do $$
declare v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.project_members'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%role%'
  loop
    execute format('alter table public.project_members drop constraint %I', v_name);
  end loop;
end $$;
alter table public.project_members
  add constraint project_members_role_check check (role in ('owner', 'manager', 'member'));

-- 운영자 또는 부운영자인지
create or replace function public.is_project_manager(p_project_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid() and role in ('owner', 'manager')
  );
$$;
grant execute on function public.is_project_manager(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 보스: 추가는 운영자·부운영자, 수정·삭제는 운영자만 (0005의 for all 정책을 나눈다)
drop policy if exists "owner can manage bosses" on public.bosses;
drop policy if exists "owner can add bosses" on public.bosses;
drop policy if exists "managers can add bosses" on public.bosses;
drop policy if exists "owner can update bosses" on public.bosses;
drop policy if exists "owner can delete bosses" on public.bosses;
create policy "managers can add bosses" on public.bosses for insert to authenticated
  with check (public.is_project_manager(project_id));
create policy "owner can update bosses" on public.bosses for update to authenticated
  using (public.is_project_owner(project_id)) with check (public.is_project_owner(project_id));
create policy "owner can delete bosses" on public.bosses for delete to authenticated
  using (public.is_project_owner(project_id));

-- 파티·파티원: 운영자·부운영자
drop policy if exists "owner can manage parties" on public.parties;
drop policy if exists "managers can manage parties" on public.parties;
create policy "managers can manage parties" on public.parties for all to authenticated
  using (public.is_project_manager(project_id)) with check (public.is_project_manager(project_id));

drop policy if exists "owner can manage party rosters" on public.party_members;
drop policy if exists "managers can manage party rosters" on public.party_members;
create policy "managers can manage party rosters" on public.party_members for all to authenticated
  using (exists (select 1 from public.parties p
                  where p.id = party_members.party_id and public.is_project_manager(p.project_id)))
  with check (exists (select 1 from public.parties p
                       where p.id = party_members.party_id and public.is_project_manager(p.project_id)));

-- 후보: 운영자·부운영자는 다른 사람 캐릭터도 후보로 넣고(파티원 빼기 때 되돌리기) 지울 수 있다
-- (전에는 insert가 본인 것만 돼서, 운영자가 남의 파티원을 빼면 후보 되돌리기가 조용히 실패했다)
drop policy if exists "managers can add boss candidates" on public.boss_candidates;
create policy "managers can add boss candidates" on public.boss_candidates for insert to authenticated
  with check (public.is_project_manager(project_id));
drop policy if exists "owner or self can delete boss candidates" on public.boss_candidates;
drop policy if exists "manager or self can delete boss candidates" on public.boss_candidates;
create policy "manager or self can delete boss candidates" on public.boss_candidates for delete to authenticated
  using (user_id = auth.uid() or public.is_project_manager(project_id));

-- 시간 확정·클리어: 그 파티의 파티원, 또는 운영자·부운영자 (0009 확장)
create or replace function public.can_edit_party_schedule(p_party_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.party_members
    where party_id = p_party_id and user_id = auth.uid()
  )
  or exists (
    select 1 from public.parties p
    where p.id = p_party_id and public.is_project_manager(p.project_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 다음주 파티 함수(0017): 운영자·부운영자
create or replace function public.make_next_roster(p_boss_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boss record;
  r record;
  v_new uuid;
  v_map jsonb := '{}'::jsonb;
begin
  select id, project_id, period, next_custom into v_boss from bosses where id = p_boss_id for update;
  if v_boss.id is null then raise exception 'boss not found'; end if;
  if not public.is_project_manager(v_boss.project_id) then raise exception 'only the owner or managers can edit next week parties'; end if;
  if v_boss.period <> 'weekly' then raise exception 'monthly bosses have no next week parties'; end if;
  if v_boss.next_custom then return v_map; end if;

  for r in select * from parties where boss_id = p_boss_id and week = 'this' order by sort_order, created_at loop
    insert into parties (project_id, boss_id, label, sort_order, week)
    values (r.project_id, r.boss_id, r.label, r.sort_order, 'next')
    returning id into v_new;
    insert into party_members (party_id, user_id, character_name)
    select v_new, user_id, character_name from party_members where party_id = r.id;
    update next_party_confirmations set party_id = v_new where party_id = r.id;
    v_map := v_map || jsonb_build_object(r.id::text, v_new::text);
  end loop;

  update bosses set next_custom = true where id = p_boss_id;
  return v_map;
end;
$$;

create or replace function public.reset_next_roster(p_boss_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from bosses where id = p_boss_id for update;
  if v_project is null then raise exception 'boss not found'; end if;
  if not public.is_project_manager(v_project) then raise exception 'only the owner or managers can edit next week parties'; end if;
  delete from parties where boss_id = p_boss_id and week = 'next';
  update bosses set next_custom = false where id = p_boss_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 직책 지정: 운영자만, 멤버 <-> 부운영자 사이에서만 (운영자 넘기기는 transfer_project_ownership)
create or replace function public.set_member_role(p_project_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_project_owner(p_project_id) then
    raise exception '운영자만 직책을 바꿀 수 있어요.';
  end if;
  if p_role not in ('manager', 'member') then
    raise exception '부운영자 또는 멤버로만 바꿀 수 있어요.';
  end if;
  update public.project_members set role = p_role
   where project_id = p_project_id and user_id = p_user_id and role <> 'owner';
  if not found then
    raise exception '대상이 이 그룹의 멤버가 아니거나 운영자예요.';
  end if;
end;
$$;
revoke execute on function public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- 운영자 양도: 안내 문구만 "운영자"로 (동작은 0005와 같음, 이전 운영자는 멤버가 된다)
create or replace function public.transfer_project_ownership(p_project_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_project_owner(p_project_id) then
    raise exception '운영자만 양도할 수 있어요.';
  end if;
  if p_new_owner_id = auth.uid() then
    raise exception '이미 운영자예요.';
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
