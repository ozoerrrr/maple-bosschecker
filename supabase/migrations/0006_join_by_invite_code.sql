-- 초대코드로 참여하기가 "초대코드를 찾을 수 없어요"로 항상 실패하던 버그 수정.
-- 원인: projects 테이블의 select RLS 정책이
--   using (public.is_project_member(id) or owner_id = auth.uid())
-- 라서, 아직 멤버가 아닌 사람이 초대코드로 프로젝트를 조회하는 시점(=멤버가
-- 되기 "전")에는 그 row 자체가 안 보임 -- 전형적인 닭과 달걀 문제.
-- SECURITY DEFINER 함수로 RLS를 우회해서 "조회 + 멤버 추가"를 원자적으로 처리한다.
create or replace function public.join_project_by_invite_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select id into v_project_id
  from public.projects
  where invite_code = p_invite_code;

  if v_project_id is null then
    raise exception '초대코드를 찾을 수 없어요.';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (v_project_id, auth.uid(), 'member')
  on conflict (project_id, user_id) do nothing;

  return v_project_id;
end;
$$;

grant execute on function public.join_project_by_invite_code(text) to authenticated;
