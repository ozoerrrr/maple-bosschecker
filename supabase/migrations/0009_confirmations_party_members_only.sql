-- 0009: 파티 확정·완료·해제를 "그 파티의 파티원 + 그룹장"으로 제한
--
-- [추가 이유]
-- 0001에서는 그룹원이면 누구나 모든 파티의 확정 정보를 쓰고 지울 수 있었다.
-- 그래서 남의 파티 일정을 실수로 확정하거나 해제하는 일이 생길 수 있었다.
-- 이제 아래 둘 중 하나일 때만 쓰기(insert/update/delete)를 허용한다.
--   1) 해당 파티의 파티원 (party_members에 본인이 있음)
--   2) 그 파티가 속한 그룹의 그룹장 (is_project_owner)
-- 읽기 정책("members can read ...")은 그대로 두므로 그룹원 모두 확정 일정을 볼 수 있다.
-- 화면(PartyCard.tsx)에서도 같은 규칙(canEdit = isInParty || isOwner)으로 버튼을 숨긴다.

-- [추가] 권한 판단 함수: RLS 안에서 party_members/parties를 조회해야 하므로 security definer로 만든다
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
    where p.id = p_party_id and public.is_project_owner(p.project_id)
  );
$$;

grant execute on function public.can_edit_party_schedule(uuid) to authenticated;

-- [변경] 이번 주 확정(party_confirmations) 쓰기 정책
drop policy if exists "members can manage confirmations" on public.party_confirmations;
create policy "party members or owner can manage confirmations"
  on public.party_confirmations
  for all
  to authenticated
  using (public.can_edit_party_schedule(party_id))
  with check (public.can_edit_party_schedule(party_id));

-- [변경] 다음 주 확정(next_party_confirmations) 쓰기 정책
drop policy if exists "members can manage next confirmations" on public.next_party_confirmations;
create policy "party members or owner can manage next confirmations"
  on public.next_party_confirmations
  for all
  to authenticated
  using (public.can_edit_party_schedule(party_id))
  with check (public.can_edit_party_schedule(party_id));
