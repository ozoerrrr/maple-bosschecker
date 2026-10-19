-- 0017: 다음주 파티 구성 (원본 레이드 시간표의 "다음주" 파티)
--
-- [추가 이유]
-- 그룹장이 그룹 관리의 [이번주 | 다음주] 토글로 다음주 파티를 이번주와 다르게 짤 수 있게 한다.
-- - 파티에 주 구분(parties.week: this/next)을 붙인다. 기존 파티는 모두 this.
-- - 보스마다 "다음주 따로" 표시(bosses.next_custom)를 둔다.
--   꺼져 있으면 다음주 파티 = 이번주 파티(주중에 이번주를 고치면 다음주에도 그대로 반영).
--   그룹장이 다음주 탭에서 그 보스를 처음 고칠 때 make_next_roster()가 이번주 파티를 복사해
--   다음주 전용 파티를 만들고 표시를 켠다. 이미 잡은 다음주 미리확정은 복사된 파티로 옮긴다.
-- - 목요일 0시 주간 리셋(weekly_reset_core)에서 "다음주 따로"인 보스는 이번주 파티를 지우고
--   다음주 파티를 이번주로 올린 뒤 표시를 끈다 -> 새 다음주는 다시 "이번주와 같음"에서 시작.
-- - 월간 보스(검은 마법사)는 주 구분 없이 파티 하나만 쓴다 (make_next_roster가 거부).
-- 여러 번 실행해도 안전하다.

alter table public.parties add column if not exists week text not null default 'this';
do $$ begin
  alter table public.parties add constraint parties_week_check check (week in ('this', 'next'));
exception when duplicate_object then null; end $$;
create index if not exists parties_boss_week_idx on public.parties (boss_id, week);

alter table public.bosses add column if not exists next_custom boolean not null default false;

-- ---------------------------------------------------------------------------
-- 다음주 전용 파티 만들기 (그룹장만). 이미 "다음주 따로"면 아무것도 안 한다.
-- 돌려주는 값: {"이번주 파티 id": "복사된 다음주 파티 id", ...} -- 화면이 고치던 파티를 새 id로 바꿔 잡는 데 쓴다.
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
  if not public.is_project_owner(v_boss.project_id) then raise exception 'only the owner can edit next week parties'; end if;
  if v_boss.period <> 'weekly' then raise exception 'monthly bosses have no next week parties'; end if;
  if v_boss.next_custom then return v_map; end if;

  for r in select * from parties where boss_id = p_boss_id and week = 'this' order by sort_order, created_at loop
    insert into parties (project_id, boss_id, label, sort_order, week)
    values (r.project_id, r.boss_id, r.label, r.sort_order, 'next')
    returning id into v_new;
    insert into party_members (party_id, user_id, character_name)
    select v_new, user_id, character_name from party_members where party_id = r.id;
    -- 이번주 파티에 잡아둔 다음주 미리확정은 다음주 파티로 옮긴다
    update next_party_confirmations set party_id = v_new where party_id = r.id;
    v_map := v_map || jsonb_build_object(r.id::text, v_new::text);
  end loop;

  update bosses set next_custom = true where id = p_boss_id;
  return v_map;
end;
$$;
revoke execute on function public.make_next_roster(uuid) from public, anon;
grant execute on function public.make_next_roster(uuid) to authenticated;

-- 다음주를 이번주와 같게 되돌리기 (그룹장만): 다음주 전용 파티와 그 미리확정을 지운다.
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
  if not public.is_project_owner(v_project) then raise exception 'only the owner can edit next week parties'; end if;
  delete from parties where boss_id = p_boss_id and week = 'next'; -- 파티원·미리확정은 cascade
  update bosses set next_custom = false where id = p_boss_id;
end;
$$;
revoke execute on function public.reset_next_roster(uuid) from public, anon;
grant execute on function public.reset_next_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 디스코드 알림의 "N파티" 번호: 같은 주(this/next) 파티끼리만 센다
create or replace function public.notify_party_label(p_party_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(x.label, ''), x.rn || '파티')
    from (select p.id, p.label, row_number() over (partition by p.boss_id order by p.sort_order, p.created_at, p.id) rn
            from parties p
           where p.boss_id = (select boss_id from parties where id = p_party_id)
             and p.week = (select week from parties where id = p_party_id)) x
   where x.id = p_party_id;
$$;

-- ---------------------------------------------------------------------------
-- 주간 리셋: 0016 내용 + (1-1) 다음주 파티 승격
create or replace function public.weekly_reset_core(p_project_id uuid, p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (p_now at time zone 'Asia/Seoul')::date; -- p_now는 예약 작업·테스트에서 넘긴다
  v_week  date;
  v_prev  date;
begin
  perform set_config('app.suppress_notify', 'on', true);
  v_week := v_today - ((extract(isodow from v_today)::int - 4 + 7) % 7); -- 이번주 목요일

  select week_state_for into v_prev from projects where id = p_project_id for update;
  if v_prev is not null and v_prev >= v_week then
    return false; -- 이미 이번주로 처리됨
  end if;
  update projects set week_state_for = v_week where id = p_project_id;
  if v_prev is null then
    return false; -- 처음 한 번은 기준 주만 기록
  end if;

  -- (1) 지난주 주간보스 확정·완료 삭제 (월간보스는 그대로)
  delete from party_confirmations pc
   using parties p, bosses b
   where pc.party_id = p.id and b.id = p.boss_id
     and p.project_id = p_project_id and b.period = 'weekly';

  -- (1-1) [추가 0017] "다음주 따로"인 보스: 이번주 파티를 지우고 다음주 파티를 이번주로 올린다
  delete from parties p
   using bosses b
   where p.boss_id = b.id and b.project_id = p_project_id and b.next_custom and p.week = 'this';
  update parties p set week = 'this'
    from bosses b
   where p.boss_id = b.id and b.project_id = p_project_id and b.next_custom and p.week = 'next';
  -- 표시가 꺼진 보스에 남은 다음주 파티(있으면 안 되는 찌꺼기)는 지운다
  delete from parties p
   using bosses b
   where p.boss_id = b.id and b.project_id = p_project_id and not b.next_custom and p.week = 'next';
  update bosses set next_custom = false where project_id = p_project_id and next_custom;

  -- (2) 다음주 미리확정을 이번주 확정으로 승격 (승격된 다음주 파티의 미리확정도 여기서 함께 올라간다)
  insert into party_confirmations (party_id, day, hour, confirmed_date, cleared, confirmed_by)
  select n.party_id, n.day, n.hour, null, false, n.confirmed_by
    from next_party_confirmations n
    join parties p on p.id = n.party_id
   where p.project_id = p_project_id
  on conflict (party_id) do nothing;
  delete from next_party_confirmations n
   using parties p
   where n.party_id = p.id and p.project_id = p_project_id;

  -- (3) 다음주 가능 시간을 입력한 사람만 그 시간표로 교체
  delete from availability a
   where a.project_id = p_project_id
     and exists (select 1 from next_availability n
                  where n.project_id = p_project_id and n.user_id = a.user_id);
  insert into availability (project_id, user_id, day, hour)
  select project_id, user_id, day, hour from next_availability where project_id = p_project_id;
  delete from next_availability where project_id = p_project_id;

  -- (4) 다음주 솔로 계획을 세운 캐릭터만 이번주 계획을 그 계획으로 교체
  delete from solo_plans s
   where s.project_id = p_project_id and s.week = 'this'
     and exists (select 1 from solo_plans n
                  where n.project_id = p_project_id and n.week = 'next'
                    and n.user_id = s.user_id and n.character_name = s.character_name);
  update solo_plans set week = 'this', updated_at = now()
   where project_id = p_project_id and week = 'next';

  -- 리셋으로 지워진 확정은 "변경" 판단에 쓰지 않는다
  delete from party_confirm_recent r using parties p where r.party_id = p.id and p.project_id = p_project_id;
  return true;
end;
$$;
revoke execute on function public.weekly_reset_core(uuid, timestamptz) from public, anon, authenticated;
