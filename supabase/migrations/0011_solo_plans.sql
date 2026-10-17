-- 0011: 캐릭터별 솔로 보스 계획 / 솔로 클리어 / 직접 추가한 캐릭터
--
-- [추가 이유]
-- 레이드 시간표(아티팩트)의 solo·soloSize·soloNext·soloCleared·extraChars를 DB로 옮긴다.
-- 쓰기는 본인 행만, 읽기는 그룹원 모두 (나중에 '이번주 순위'에서 남의 수익을 계산하기 위해).
-- 0010 다음에 실행한다 (apply_weekly_reset을 다시 정의해 솔로 계획 승격을 추가한다).

-- [추가] 캐릭터별 솔로 보스 계획 (week = 'this' 이번주 / 'next' 다음주 미리 계획)
create table if not exists public.solo_plans (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  character_name text not null,
  boss_name text not null,
  difficulty text not null check (difficulty in ('easy','normal','hard','chaos','extreme')),
  party_size int not null default 1 check (party_size between 1 and 6), -- 1 = 솔로, 2~6 = 공팟 인원수
  week text not null default 'this' check (week in ('this','next')),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id, character_name, boss_name, week)
);

-- [추가] 솔로 보스 클리어 체크. period_key: 주간 'w2026-10-15'(그 주 목요일), 월간 'm2026-10'
create table if not exists public.solo_clears (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  character_name text not null,
  boss_name text not null,
  period_key text not null,
  primary key (project_id, user_id, character_name, boss_name, period_key)
);

-- [추가] 파티가 없어도 메소 카드에 보이게 직접 추가한 캐릭터
create table if not exists public.extra_characters (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  character_name text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id, character_name)
);

-- [추가] RLS: 세 테이블 모두 그룹원은 읽기, 본인 행만 쓰기
alter table public.solo_plans enable row level security;
alter table public.solo_clears enable row level security;
alter table public.extra_characters enable row level security;

create policy "members can read solo plans" on public.solo_plans
  for select to authenticated using (public.is_project_member(project_id));
create policy "own solo plans" on public.solo_plans
  for all to authenticated
  using (user_id = auth.uid() and public.is_project_member(project_id))
  with check (user_id = auth.uid() and public.is_project_member(project_id));

create policy "members can read solo clears" on public.solo_clears
  for select to authenticated using (public.is_project_member(project_id));
create policy "own solo clears" on public.solo_clears
  for all to authenticated
  using (user_id = auth.uid() and public.is_project_member(project_id))
  with check (user_id = auth.uid() and public.is_project_member(project_id));

create policy "members can read extra characters" on public.extra_characters
  for select to authenticated using (public.is_project_member(project_id));
create policy "own extra characters" on public.extra_characters
  for all to authenticated
  using (user_id = auth.uid() and public.is_project_member(project_id))
  with check (user_id = auth.uid() and public.is_project_member(project_id));

-- [변경] 주간 리셋: 0010 내용 그대로 + (4) 다음주 솔로 계획 승격
create or replace function public.apply_weekly_reset(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_week  date;
  v_prev  date;
begin
  if not public.is_project_member(p_project_id) then
    raise exception 'not a project member';
  end if;
  v_week := v_today - ((extract(isodow from v_today)::int - 4 + 7) % 7); -- 이번주 목요일

  -- 같은 순간 여러 명이 열어도 한 번만 처리되도록 그룹 행을 잠근다
  select week_state_for into v_prev from projects where id = p_project_id for update;
  if v_prev is not null and v_prev >= v_week then
    return false; -- 이미 이번주로 처리됨
  end if;
  update projects set week_state_for = v_week where id = p_project_id;
  if v_prev is null then
    return false; -- 처음 한 번은 기준 주만 기록 (배포 직후 이번주 데이터를 지우지 않기 위해)
  end if;

  -- (1) 지난주 주간보스 확정·완료 삭제 (월간보스는 그대로)
  delete from party_confirmations pc
   using parties p, bosses b
   where pc.party_id = p.id and b.id = p.boss_id
     and p.project_id = p_project_id and b.period = 'weekly';

  -- (2) 다음주 미리확정을 이번주 확정으로 승격
  insert into party_confirmations (party_id, day, hour, confirmed_date, cleared, confirmed_by)
  select n.party_id, n.day, n.hour, null, false, n.confirmed_by
    from next_party_confirmations n
    join parties p on p.id = n.party_id
   where p.project_id = p_project_id
  on conflict (party_id) do nothing;
  delete from next_party_confirmations n
   using parties p
   where n.party_id = p.id and p.project_id = p_project_id;

  -- (3) 다음주 가능 시간을 입력한 사람만 그 시간표로 교체, 안 한 사람은 이번주 시간표 유지
  delete from availability a
   where a.project_id = p_project_id
     and exists (select 1 from next_availability n
                  where n.project_id = p_project_id and n.user_id = a.user_id);
  insert into availability (project_id, user_id, day, hour)
  select project_id, user_id, day, hour from next_availability where project_id = p_project_id;
  delete from next_availability where project_id = p_project_id;

  -- (4) [0011 추가] 다음주 솔로 계획을 세운 캐릭터만 이번주 계획을 그 계획으로 교체
  delete from solo_plans s
   where s.project_id = p_project_id and s.week = 'this'
     and exists (select 1 from solo_plans n
                  where n.project_id = p_project_id and n.week = 'next'
                    and n.user_id = s.user_id and n.character_name = s.character_name);
  update solo_plans set week = 'this', updated_at = now()
   where project_id = p_project_id and week = 'next';

  return true;
end;
$$;

grant execute on function public.apply_weekly_reset(uuid) to authenticated;
