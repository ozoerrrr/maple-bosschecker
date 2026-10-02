-- ============================================================================
-- 넥슨에서 불러온 캐릭터를 "후보 풀"에 담아두고, 소유자가 드래그 앤 드롭으로
-- 파티에 배정할 수 있게 하는 기능.
--
-- party_members.character_name: 파티원이 이 파티를 어떤 캐릭터로 도는지
-- (원본 아티팩트의 { id, char } 멤버 구조 -- user_id만 쓰도록 정규화하면서
-- 빠졌던 부분을 다시 들여온다). nullable: 수동으로 멤버만 추가하고 캐릭터는
-- 안 정해도 되게.
--
-- boss_candidates: 넥슨에서 "이 보스를 등록해둔 캐릭터"로 불러왔지만 아직
-- 어느 파티에도 안 들어간 캐릭터들. 드래그해서 파티에 놓으면 party_members로
-- 옮겨지고 이 행은 삭제된다(또는 파티에서 빼면 다시 여기로 돌아온다).
-- ============================================================================

alter table public.party_members
  add column character_name text;

create table public.boss_candidates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  boss_id uuid not null references public.bosses(id) on delete cascade,
  -- 이 캐릭터가 어느 "프로젝트 멤버(웹앱 계정)" 소속인지. 넥슨 API는 닉네임만
  -- 알면 조회되므로(계정 소유권 증명이 아님 -- src/lib/nexon/client.ts 상단
  -- 설명 참고) 소유자가 조회 시점에 직접 멤버를 지정해 태깅한다.
  user_id uuid not null references auth.users(id) on delete cascade,
  character_name text not null,
  created_at timestamptz not null default now(),
  unique (boss_id, user_id, character_name)
);

alter table public.boss_candidates enable row level security;

create policy "members can read boss candidates"
  on public.boss_candidates for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can manage boss candidates"
  on public.boss_candidates for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

create index idx_boss_candidates_project_boss on public.boss_candidates(project_id, boss_id);
