-- 0016: 디스코드 알림 + 목요일 0시 자동 주간 리셋
--
-- [추가 이유]
-- 그룹장이 그룹 관리에서 디스코드 웹후크를 연결하고 알림을 켜고 끈다.
--   1) 파티 확정      : 이번주 파티 시간을 처음 확정할 때 (그 파티원 멘션)
--   2) 확정 변경      : 확정된 시간을 다른 시간으로 바꿀 때 (그 파티원 멘션)
--   3) 주간 리셋      : 매주 목요일 0시 "보스 확정해 주세요~" (그룹원 전체 멘션)
--   4) 가능 시간 기입 : 그룹이 정한 요일·시각(기본 수 21시) "다음주 가능 시간 기입해 주세요~"
--                       (이번 주에 다음주 가능 시간을 한 칸도 안 넣은 그룹원만 멘션)
-- 보내지 않는 것: 다음주 미리확정, 확정 취소, 클리어, 시간 없는 즉석 클리어, 주간 리셋 때의 확정 승격.
-- 멘션은 profiles.discord_user_id(프로필의 "디스코드 연결")로 하고, 없는 사람은 이름 + "(디코 미연동)"으로 적는다.
-- 발송은 DB에서 직접 한다 (pg_net). 정해진 시각 작업은 pg_cron이 매시간 정각에 discord_hourly_tick()을 부른다.
-- 목요일 0시에는 모든 그룹의 주간 리셋도 같이 실행한다 (페이지를 열 때의 리셋은 안전장치로 남는다).
-- 여러 번 실행해도 안전하다.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------------
-- 디스코드 계정 연결 (계정 단위, 모든 그룹에서 공통)
alter table public.profiles add column if not exists discord_user_id text;
alter table public.profiles add column if not exists discord_username text;

-- ---------------------------------------------------------------------------
-- 그룹별 알림 설정 (그룹장만 읽고 쓴다 -- 웹후크 주소는 비밀)
create table if not exists public.project_notifications (
  project_id uuid primary key references public.projects(id) on delete cascade,
  webhook_url text check (webhook_url is null or webhook_url ~ '^https://(discord|discordapp)\.com/api/webhooks/'),
  notify_confirm boolean not null default true,
  notify_change boolean not null default true,
  notify_reset boolean not null default true,
  notify_avail boolean not null default true,
  avail_dow int not null default 3 check (avail_dow between 0 and 6),   -- 0=일 ... 3=수 ... 6=토
  avail_hour int not null default 21 check (avail_hour between 0 and 23),
  last_reset_week date,   -- 같은 주에 두 번 보내지 않기 위한 기록 (그 주 목요일 날짜)
  last_avail_week date,
  updated_at timestamptz not null default now()
);
alter table public.project_notifications enable row level security;
drop policy if exists "owner manages notifications" on public.project_notifications;
create policy "owner manages notifications" on public.project_notifications for all to authenticated
  using (public.is_project_owner(project_id)) with check (public.is_project_owner(project_id));

-- 방금 확정 취소된 시간 (취소 -> 다시 확정을 "확정 변경"으로 알리기 위해 10분 동안 기억). 함수만 쓴다.
create table if not exists public.party_confirm_recent (
  party_id uuid primary key references public.parties(id) on delete cascade,
  day text,
  hour int,
  confirmed_date date,
  deleted_at timestamptz not null default now()
);
alter table public.party_confirm_recent enable row level security;

-- ---------------------------------------------------------------------------
-- 메시지 조립 도우미

-- 보스 표시 이름 (웹의 displayBossName과 같은 풀네임) + 난이도
create or replace function public.notify_boss_label(p_boss_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case b.name
           when '세렌' then '선택받은 세렌'
           when '칼로스' then '감시자 칼로스'
           when '대적자' then '최초의 대적자'
           when '흉성' then '찬란한 흉성'
           else b.name end
         || coalesce(' ' || upper(b.difficulty), '')
    from bosses b where b.id = p_boss_id;
$$;

-- 파티 이름 (이름이 없으면 그 보스 안에서 "N파티")
create or replace function public.notify_party_label(p_party_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(x.label, ''), x.rn || '파티')
    from (select p.id, p.label, row_number() over (partition by p.boss_id order by p.sort_order, p.created_at, p.id) rn
            from parties p where p.boss_id = (select boss_id from parties where id = p_party_id)) x
   where x.id = p_party_id;
$$;

-- 확정 시간 표기 ("일 19시", 월간 "10/3 (토) 21시")
create or replace function public.notify_slot(p_day text, p_hour int, p_date date) returns text
language sql immutable as $$
  select case
    when p_date is not null then
      extract(month from p_date)::int || '/' || extract(day from p_date)::int || ' ('
      || (array['일','월','화','수','목','금','토'])[extract(dow from p_date)::int + 1] || ') ' || p_hour || '시'
    else p_day || ' ' || p_hour || '시' end;
$$;

-- 디스코드로 보내기: [그룹이름] 내용 + 멘션 줄. 멘션은 지정한 사람만 울리게 allowed_mentions로 제한한다.
-- 웹후크가 없거나 알림을 못 보내도 원래 작업(확정 등)은 막지 않는다.
create or replace function public.notify_send(p_project_id uuid, p_content text, p_user_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_name text;
  v_mention text;
  v_ids text[];
begin
  select n.webhook_url, pr.name into v_url, v_name
    from project_notifications n join projects pr on pr.id = n.project_id
   where n.project_id = p_project_id;
  if v_url is null then return; end if;

  select string_agg(case when pf.discord_user_id is not null then '<@' || pf.discord_user_id || '>'
                         else pf.display_name || '(디코 미연동)' end, ' ' order by pf.display_name),
         coalesce(array_agg(pf.discord_user_id) filter (where pf.discord_user_id is not null), '{}')
    into v_mention, v_ids
    from profiles pf where pf.id = any(coalesce(p_user_ids, '{}'));

  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'content', '[' || v_name || '] ' || p_content || coalesce(E'\n' || v_mention, ''),
        'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', to_jsonb(v_ids))
      ),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    raise warning 'discord notify failed: %', sqlerrm;
  end;
end;
$$;
revoke execute on function public.notify_send(uuid, text, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 파티 확정 / 확정 변경 알림 (이번주 확정 테이블만)
create or replace function public.party_confirm_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_party record;
  v_prev record;
  v_has_prev boolean := false;
  v_n project_notifications%rowtype;
  v_members uuid[];
  v_label text;
begin
  -- 주간 리셋 중(다음주 확정 승격 등)에는 보내지 않는다
  if coalesce(current_setting('app.suppress_notify', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'DELETE' then
    -- 확정 취소는 알리지 않고, 10분 안에 다시 확정하면 "변경"으로 알리기 위해 기억만 한다
    if old.day is not null or old.confirmed_date is not null then
      insert into party_confirm_recent (party_id, day, hour, confirmed_date, deleted_at)
      values (old.party_id, old.day, old.hour, old.confirmed_date, now())
      on conflict (party_id) do update
        set day = excluded.day, hour = excluded.hour, confirmed_date = excluded.confirmed_date, deleted_at = now();
    end if;
    return null;
  end if;

  -- 시간 없는 즉석 클리어, 클리어만 바뀐 경우는 보내지 않는다
  if new.day is null and new.confirmed_date is null then return null; end if;
  if tg_op = 'UPDATE' and old.day is not distinct from new.day and old.hour is not distinct from new.hour
     and old.confirmed_date is not distinct from new.confirmed_date then
    return null;
  end if;

  -- 이전 시간: 같은 행이 바뀐 경우(update) 또는 10분 안에 취소됐던 시간
  if tg_op = 'UPDATE' and (old.day is not null or old.confirmed_date is not null) then
    select old.day as day, old.hour as hour, old.confirmed_date as confirmed_date into v_prev;
    v_has_prev := true;
  else
    select r.day, r.hour, r.confirmed_date into v_prev
      from party_confirm_recent r
     where r.party_id = new.party_id and r.deleted_at > now() - interval '10 minutes';
    v_has_prev := found;
  end if;
  delete from party_confirm_recent where party_id = new.party_id;

  select p.id, p.project_id, p.boss_id into v_party from parties p where p.id = new.party_id;
  if not found then return null; end if;
  select * into v_n from project_notifications where project_id = v_party.project_id;
  if not found or v_n.webhook_url is null then return null; end if;

  select coalesce(array_agg(pm.user_id), '{}') into v_members from party_members pm where pm.party_id = new.party_id;
  v_label := notify_boss_label(v_party.boss_id) || ' ' || notify_party_label(new.party_id);

  if v_has_prev and (v_prev.day is distinct from new.day or v_prev.hour is distinct from new.hour
                     or v_prev.confirmed_date is distinct from new.confirmed_date) then
    if v_n.notify_change then
      perform notify_send(v_party.project_id,
        '🔁 ' || v_label || ' — ' || notify_slot(v_prev.day, v_prev.hour, v_prev.confirmed_date)
        || ' → ' || notify_slot(new.day, new.hour, new.confirmed_date) || '로 변경',
        v_members);
    end if;
  elsif v_n.notify_confirm then
    perform notify_send(v_party.project_id,
      '🗓️ ' || v_label || ' — ' || notify_slot(new.day, new.hour, new.confirmed_date) || ' 확정',
      v_members);
  end if;
  return null;
end;
$$;

drop trigger if exists party_confirm_notify on public.party_confirmations;
create trigger party_confirm_notify
  after insert or update or delete on public.party_confirmations
  for each row execute function public.party_confirm_notify();

-- ---------------------------------------------------------------------------
-- 주간 리셋: 실제 처리(weekly_reset_core)를 분리해 예약 작업에서도 부를 수 있게 한다.
-- 내용은 0011의 apply_weekly_reset과 같고, 그룹원 확인만 빠졌다(예약 작업에는 로그인 사용자가 없음).
-- 리셋 중 확정 승격은 알림을 보내지 않도록 app.suppress_notify를 켠다(이 트랜잭션 안에서만).
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

-- 페이지를 열 때 부르는 기존 함수: 그룹원 확인 후 core 실행 (안전장치)
create or replace function public.apply_weekly_reset(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_project_member(p_project_id) then
    raise exception 'not a project member';
  end if;
  return public.weekly_reset_core(p_project_id);
end;
$$;
grant execute on function public.apply_weekly_reset(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 매시간 정각 작업: 목요일 0시 리셋 + 리셋 알림, 그룹별 가능 시간 기입 알림
-- p_now는 테스트용 (평소에는 지금 시각)
create or replace function public.discord_hourly_tick(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Seoul';
  v_today date := v_local::date;
  v_dow int := extract(dow from v_local)::int;      -- 0=일 ... 6=토
  v_hour int := extract(hour from v_local)::int;
  v_week date := v_today - ((extract(isodow from v_today)::int - 4 + 7) % 7); -- 이번주 목요일
  r record;
  v_users uuid[];
begin
  -- 목요일 0시: 모든 그룹 주간 리셋 + 알림 켠 그룹에 "보스 확정해 주세요~" (그룹원 전체 멘션)
  if v_dow = 4 and v_hour = 0 then
    for r in select id from projects loop
      perform weekly_reset_core(r.id, p_now);
    end loop;
    for r in select * from project_notifications
              where notify_reset and webhook_url is not null
                and (last_reset_week is null or last_reset_week < v_week) loop
      select coalesce(array_agg(user_id), '{}') into v_users from project_members where project_id = r.project_id;
      perform notify_send(r.project_id, '🍁 새 주가 시작됐어요! 보스 확정해 주세요~', v_users);
      update project_notifications set last_reset_week = v_week where project_id = r.project_id;
    end loop;
  end if;

  -- 그룹이 정한 요일·시각: 이번 주에 다음주 가능 시간을 한 칸도 안 넣은 그룹원에게 기입 알림
  for r in select * from project_notifications
            where notify_avail and webhook_url is not null
              and avail_dow = v_dow and avail_hour = v_hour
              and (last_avail_week is null or last_avail_week < v_week) loop
    select coalesce(array_agg(m.user_id), '{}') into v_users
      from project_members m
     where m.project_id = r.project_id
       and not exists (select 1 from next_availability n where n.project_id = r.project_id and n.user_id = m.user_id);
    if array_length(v_users, 1) > 0 then
      perform notify_send(r.project_id, '🕒 다음주 가능 시간 기입해 주세요~', v_users);
    end if;
    update project_notifications set last_avail_week = v_week where project_id = r.project_id;
  end loop;
end;
$$;
revoke execute on function public.discord_hourly_tick(timestamptz) from public, anon, authenticated;

-- 매시간 정각 실행 (UTC 기준 매시 0분 = 한국시간 매시 0분). 이미 있으면 지우고 다시 등록.
select cron.unschedule(jobid) from cron.job where jobname = 'raid-scheduler-hourly';
select cron.schedule('raid-scheduler-hourly', '0 * * * *', 'select public.discord_hourly_tick()');
