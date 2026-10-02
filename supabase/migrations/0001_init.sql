-- ============================================================================
-- 레이드 스케줄러 초기 스키마
-- 원본 Claude Artifact(raid_schedule.html)의 단일 STATE 블록을
-- "프로젝트(워크스페이스) 단위로 격리된" 정규화 테이블로 옮긴 것.
--
-- 대응 관계 (원본 STATE 필드 -> 새 테이블):
--   STATE.avail[uid]            -> availability
--   STATE.nextAvail[uid]        -> next_availability
--   STATE.confirmed[pid]        -> party_confirmations (cleared=false)
--   STATE.cleared[pid]          -> party_confirmations.cleared
--   STATE.nextConfirmed[pid]    -> next_party_confirmations
--   STATE.monthlyBlock[uid]     -> monthly_block
--   STATE.weekStateFor          -> projects.week_state_for
--   RAW_PARTIES / partyOverrides/ removedParties / extraParties
--                                -> parties + party_members (직접 CRUD 가능한 실제 행)
--   보스 목록(하드코딩된 BOSS_ORDER) -> bosses (프로젝트마다 커스터마이즈)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: auth.users 1:1. Google 로그인으로 생성되고, 넥슨 오픈 API 개인
-- 키를 연동하면 캐릭터 정보가 채워진다. API 키 원문은 여기 저장하지 않고
-- (서버 전용 route handler에서 암호화해 저장하거나, 가능하면 Vault 사용)
-- 표시용 요약만 둔다.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  nexon_character_name text,
  nexon_world_name text,
  nexon_linked_at timestamptz,
  nexon_api_key_enc text, -- AES-GCM 암호문 (서버 route handler에서만 복호화)
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are readable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users manage their own profile"
  on public.profiles for all
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 신규 가입 시 auth.users -> profiles 자동 생성
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- projects: "빈 프로젝트"로 생성되는 그룹 단위 워크스페이스. 보스 명단이
-- 하드코딩되어 있던 원본과 달리, 생성 직후엔 보스가 하나도 없다 -- 그룹마다
-- settings 화면에서 직접 채워 넣는다.
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default encode(gen_random_bytes(5), 'hex'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- 원본 STATE.weekStateFor: 마지막으로 주간 리셋이 반영된 "이번주 시작일"(목요일).
  week_state_for date,
  max_per_hour int not null default 3,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  color text, -- UI 배지 색 (원본의 참가자별 점 색상)
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.project_members enable row level security;

create function public.is_project_member(p_project_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

create function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create policy "members can see their projects"
  on public.projects for select
  to authenticated
  using (public.is_project_member(id));

create policy "any signed-in user can create a project"
  on public.projects for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owner can update project settings"
  on public.projects for update
  to authenticated
  using (public.is_project_owner(id))
  with check (public.is_project_owner(id));

create policy "members can see the member list"
  on public.project_members for select
  to authenticated
  using (public.is_project_member(project_id));

-- 프로젝트 생성자는 생성 직후 자기 자신을 owner로 끼워 넣는다 (클라이언트에서
-- projects insert 다음 바로 이 insert를 호출).
create policy "user can add themself when joining or owning"
  on public.project_members for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "member can update their own row (color 등)"
  on public.project_members for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "member can leave, owner can remove others"
  on public.project_members for delete
  to authenticated
  using (user_id = auth.uid() or public.is_project_owner(project_id));

-- ---------------------------------------------------------------------------
-- bosses: 원본의 하드코딩된 BOSS_ORDER 대신, 프로젝트별로 완전히 커스텀.
-- sort_order로 원본의 BOSS_ORDER 재배치("흉성 H를 N 위로") 같은 요구를
-- 그대로 드래그 정렬 UI로 구현할 수 있게 한다.
-- ---------------------------------------------------------------------------
create table public.bosses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  period text not null default 'weekly' check (period in ('weekly', 'monthly')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.bosses enable row level security;

create policy "members can read bosses"
  on public.bosses for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can manage bosses"
  on public.bosses for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- ---------------------------------------------------------------------------
-- parties: 원본의 RAW_PARTIES(+overrides/removed/extra)를 "실제 행"으로 대체.
-- 수정/삭제/추가가 바로 이 테이블의 UPDATE/DELETE/INSERT라서, 원본의
-- "예약된 변경사항"(STATE.pendingChanges) 메커니즘 자체가 더는 필요 없다 --
-- DB가 곧 현재 상태이므로.
-- ---------------------------------------------------------------------------
create table public.parties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  boss_id uuid not null references public.bosses(id) on delete cascade,
  label text, -- 선택적 파티 이름 ("1파티" 등), 비어 있으면 UI에서 순번으로 표시
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.parties enable row level security;

create policy "members can read parties"
  on public.parties for select to authenticated
  using (public.is_project_member(project_id));

create policy "members can manage parties"
  on public.parties for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

create table public.party_members (
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (party_id, user_id)
);

alter table public.party_members enable row level security;

create policy "members can read party rosters"
  on public.party_members for select to authenticated
  using (
    exists (
      select 1 from public.parties p
      where p.id = party_id and public.is_project_member(p.project_id)
    )
  );

create policy "members can manage party rosters"
  on public.party_members for all to authenticated
  using (
    exists (
      select 1 from public.parties p
      where p.id = party_id and public.is_project_member(p.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.parties p
      where p.id = party_id and public.is_project_member(p.project_id)
    )
  );

-- ---------------------------------------------------------------------------
-- availability / next_availability: 원본 STATE.avail / STATE.nextAvail.
-- (project_id, user_id, day, hour) 한 행 = "이 시간에 가능함" 체크 하나.
-- 요일 반복(주간 고정 패턴)이라 날짜가 아니라 요일 문자열을 쓴다 (원본과 동일).
-- ---------------------------------------------------------------------------
create table public.availability (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day text not null check (day in ('목','금','토','일','월','화','수')),
  hour int not null check (hour between 0 and 23),
  primary key (project_id, user_id, day, hour)
);

alter table public.availability enable row level security;

create policy "members can read availability"
  on public.availability for select to authenticated
  using (public.is_project_member(project_id));

create policy "user manages their own availability"
  on public.availability for all to authenticated
  using (user_id = auth.uid() and public.is_project_member(project_id))
  with check (user_id = auth.uid() and public.is_project_member(project_id));

create table public.next_availability (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day text not null check (day in ('목','금','토','일','월','화','수')),
  hour int not null check (hour between 0 and 23),
  primary key (project_id, user_id, day, hour)
);

alter table public.next_availability enable row level security;

create policy "members can read next_availability"
  on public.next_availability for select to authenticated
  using (public.is_project_member(project_id));

create policy "user manages their own next_availability"
  on public.next_availability for all to authenticated
  using (user_id = auth.uid() and public.is_project_member(project_id))
  with check (user_id = auth.uid() and public.is_project_member(project_id));

-- monthly_block: 원본 STATE.monthlyBlock[uid] = ["YYYY-MM-DD", ...].
create table public.monthly_block (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_date date not null,
  primary key (project_id, user_id, blocked_date)
);

alter table public.monthly_block enable row level security;

create policy "members can read monthly_block"
  on public.monthly_block for select to authenticated
  using (public.is_project_member(project_id));

create policy "user manages their own monthly_block"
  on public.monthly_block for all to authenticated
  using (user_id = auth.uid() and public.is_project_member(project_id))
  with check (user_id = auth.uid() and public.is_project_member(project_id));

-- ---------------------------------------------------------------------------
-- party_confirmations / next_party_confirmations: 원본 STATE.confirmed /
-- STATE.cleared (주간보스는 day+hour, 월간보스는 date+hour)와
-- STATE.nextConfirmed를 합친 테이블. party_id가 PK라서 "파티 하나당 확정은
-- 하나"라는 원본 불변식이 스키마 레벨에서 보장된다.
-- ---------------------------------------------------------------------------
create table public.party_confirmations (
  party_id uuid primary key references public.parties(id) on delete cascade,
  day text check (day in ('목','금','토','일','월','화','수')), -- 주간보스
  hour int check (hour between 0 and 23),
  confirmed_date date, -- 월간보스는 day 대신 실제 날짜
  cleared boolean not null default false,
  confirmed_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.party_confirmations enable row level security;

create policy "members can read confirmations"
  on public.party_confirmations for select to authenticated
  using (
    exists (
      select 1 from public.parties p
      where p.id = party_id and public.is_project_member(p.project_id)
    )
  );

create policy "members can manage confirmations"
  on public.party_confirmations for all to authenticated
  using (
    exists (
      select 1 from public.parties p
      where p.id = party_id and public.is_project_member(p.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.parties p
      where p.id = party_id and public.is_project_member(p.project_id)
    )
  );

create table public.next_party_confirmations (
  party_id uuid primary key references public.parties(id) on delete cascade,
  day text check (day in ('목','금','토','일','월','화','수')),
  hour int check (hour between 0 and 23),
  confirmed_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.next_party_confirmations enable row level security;

create policy "members can read next confirmations"
  on public.next_party_confirmations for select to authenticated
  using (
    exists (
      select 1 from public.parties p
      where p.id = party_id and public.is_project_member(p.project_id)
    )
  );

create policy "members can manage next confirmations"
  on public.next_party_confirmations for all to authenticated
  using (
    exists (
      select 1 from public.parties p
      where p.id = party_id and public.is_project_member(p.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.parties p
      where p.id = party_id and public.is_project_member(p.project_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 인덱스
-- ---------------------------------------------------------------------------
create index idx_bosses_project on public.bosses(project_id, sort_order);
create index idx_parties_project on public.parties(project_id, boss_id, sort_order);
create index idx_party_members_user on public.party_members(user_id);
create index idx_availability_project_user on public.availability(project_id, user_id);
create index idx_next_availability_project_user on public.next_availability(project_id, user_id);
create index idx_monthly_block_project_user on public.monthly_block(project_id, user_id);
