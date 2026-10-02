-- [고침] 0005에서 bosses 테이블 전체(select 빼고)를 그룹장 전용으로 묶었는데,
-- "후보 등록은 멤버 누구나" 로 바뀌면서 문제가 생긴다: 멤버가 넥슨에서 보스를
-- 불러올 때 그 보스가 아직 그룹 명단에 없으면 bosses에 새 행을 insert해야
-- 하는데, insert까지 그룹장 전용이면 멤버는 명단에 없는 보스를 들고올 때마다
-- 실패한다. 그래서 명령어별로 쪼갠다:
--   - insert : 멤버 누구나(후보 등록 과정에서 보스가 자동으로 생겨야 하므로)
--   - update/delete : 그룹장만(보스 이름 수정/삭제/재배치 등 "관리"는 그대로 그룹장 전용)
drop policy "owner can manage bosses" on public.bosses;

create policy "members can add bosses" on public.bosses for insert to authenticated
  with check (public.is_project_member(project_id));

create policy "owner can update bosses" on public.bosses for update to authenticated
  using (public.is_project_owner(project_id)) with check (public.is_project_owner(project_id));

create policy "owner can delete bosses" on public.bosses for delete to authenticated
  using (public.is_project_owner(project_id));
