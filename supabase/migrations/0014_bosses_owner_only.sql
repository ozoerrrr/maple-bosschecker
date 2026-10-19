-- 0014: 보스 추가 권한을 다시 그룹장 전용으로
--
-- [변경 이유]
-- 0008에서 넥슨 불러오기가 그룹에 없는 보스를 자동으로 만들 수 있도록 bosses insert를 멤버 전원에게 열었다.
-- 이제 불러오기는 그룹 보스 목록을 바꾸지 않고(이미 있는 보스에만 후보 등록), 보스 일정은 그룹장만 바꾼다.
-- update/delete는 0008에서 이미 그룹장 전용이다. 여러 번 실행해도 결과는 같다.

drop policy if exists "members can add bosses" on public.bosses;
drop policy if exists "owner can add bosses" on public.bosses;

create policy "owner can add bosses" on public.bosses for insert to authenticated
  with check (public.is_project_owner(project_id));
