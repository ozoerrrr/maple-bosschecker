-- 0019: 그룹 관리 보스 목록에서 보스 숨기기
--
-- [추가 이유]
-- 그룹 관리 보스 목록은 기본 보스 목록(모든 보스 x 난이도)을 DB에 카드가 없어도 모두 깔아 둔다.
-- 우리 그룹이 안 가는 보스(난이도)를 목록에서 치울 수 있게, 그룹별로 숨긴 보스(이름+난이도)를 기억한다.
-- 기본 목록 줄은 DB 카드가 없을 수도 있어서 bosses와 따로 이름+난이도로 저장한다.
-- 화면의 "숨기기"는 "보스 삭제"를 합친 것: 보스 카드가 있으면 카드(파티·확정 포함)를 지우고 여기에 추가한다.
-- 읽기는 그룹원, 쓰기는 운영자(보스 삭제와 같은 권한). 여러 번 실행해도 안전하다.

create table if not exists public.hidden_bosses (
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  difficulty text not null default '', -- 난이도 없음 = ''
  created_at timestamptz not null default now(),
  primary key (project_id, name, difficulty)
);
alter table public.hidden_bosses enable row level security;

drop policy if exists "members can read hidden bosses" on public.hidden_bosses;
create policy "members can read hidden bosses" on public.hidden_bosses for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists "owner manages hidden bosses" on public.hidden_bosses;
create policy "owner manages hidden bosses" on public.hidden_bosses for all to authenticated
  using (public.is_project_owner(project_id)) with check (public.is_project_owner(project_id));

grant select, insert, update, delete on public.hidden_bosses to authenticated;
