-- [고침] 0005에서 보스 후보(candidate) 등록까지 그룹장 전용으로 묶어버렸는데,
-- 넥슨 API가 "본인 캐릭터만" 불러와주는 제약과 합쳐지면 그룹장 캐릭터만 후보
-- 풀에 들어갈 수 있는 구조가 되어버린다. 올바른 역할 분리는:
--   - 보스 후보 등록(내 캐릭터를 후보 풀에 올리는 것) -> 멤버 누구나 가능,
--     단 자기 자신(user_id = auth.uid()) 몫만.
--   - 실제 파티 구성(후보를 파티에 배치/파티 CRUD)          -> 그룹장 전용(그대로 유지).
-- 가능시간(availability 등)은 원래부터 "본인 것만" 정책이라 이번 변경과 무관.
drop policy "owner can manage boss candidates" on public.boss_candidates;

create policy "members can read own-scope boss candidates"
  on public.boss_candidates for select to authenticated
  using (public.is_project_member(project_id));

-- insert: 프로젝트 멤버이기만 하면 되는데, 반드시 자기 자신 몫으로만 등록
-- 가능(다른 사람 이름으로 후보를 몰래 끼워넣는 것 방지).
create policy "members can add their own boss candidates"
  on public.boss_candidates for insert to authenticated
  with check (public.is_project_member(project_id) and user_id = auth.uid());

-- update: 자기 자신 몫만 수정 가능. (그룹장은 소유권과 무관하게 수정 못함 --
-- 파티 배치는 party_members 쪽에서 그룹장 권한으로 처리하므로 여기선 필요 없음)
create policy "members can update their own boss candidates"
  on public.boss_candidates for update to authenticated
  using (user_id = auth.uid() and public.is_project_member(project_id))
  with check (user_id = auth.uid() and public.is_project_member(project_id));

-- delete: 본인 몫은 본인이 뺄 수 있고, 그룹장은 정리 차원에서 아무거나 뺄 수 있음.
create policy "owner or self can delete boss candidates"
  on public.boss_candidates for delete to authenticated
  using (user_id = auth.uid() or public.is_project_owner(project_id));
