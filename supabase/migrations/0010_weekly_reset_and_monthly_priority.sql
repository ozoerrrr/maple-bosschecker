-- 0010: 주간 리셋 + 월간보스 우선(주간 확정 밀어내기)
--
-- [추가 이유]
-- 두 작업 모두 내가 속하지 않은 파티의 확정까지 바꿔야 해서
-- 0009 RLS(파티원·그룹장만 수정)로는 브라우저에서 직접 할 수 없다.
-- 그래서 정해진 일만 하는 DB 함수(security definer)로 만들고, 호출 자격만 검사한다.
-- 주(週)는 메이플 리셋 기준인 한국시간 목요일 00:00에 시작한다.

-- [추가] 주간 리셋: 이번주로 처음 불린 순간 한 번만 동작한다 (projects.week_state_for로 판단)
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

  return true;
end;
$$;

grant execute on function public.apply_weekly_reset(uuid) to authenticated;

-- [추가] 월간보스 우선: 월간 확정 날짜가 이번주이면, 그 요일·시각에
-- 주간 확정이 한도를 넘는 파티원마다 넘친 만큼 주간 확정을 해제한다.
-- 해제 순서: 보스 목록의 뒤쪽 보스부터 (아티팩트와 같은 방식)
create or replace function public.push_out_weekly_for_monthly(p_party_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_max     int;
  v_date    date;
  v_hour    int;
  v_day     text;
  v_today   date := (now() at time zone 'Asia/Seoul')::date;
  v_week    date;
  v_uid     uuid;
  v_count   int;
  v_victim  uuid;
  v_removed int := 0;
begin
  if not public.can_edit_party_schedule(p_party_id) then
    raise exception 'not allowed';
  end if;

  select p.project_id, pr.max_per_hour into v_project, v_max
    from parties p join projects pr on pr.id = p.project_id
   where p.id = p_party_id;
  select confirmed_date, hour into v_date, v_hour
    from party_confirmations
   where party_id = p_party_id and not cleared;
  if v_date is null or v_hour is null then
    return 0;
  end if;

  v_week := v_today - ((extract(isodow from v_today)::int - 4 + 7) % 7);
  if v_date < v_week or v_date >= v_week + 7 then
    return 0; -- 이번주가 아니면 주간 확정과 겹칠 일이 없다
  end if;
  v_day := (array['월','화','수','목','금','토','일'])[extract(isodow from v_date)::int];

  for v_uid in select user_id from party_members where party_id = p_party_id loop
    loop
      select count(*) into v_count
        from party_confirmations pc
        join parties p on p.id = pc.party_id
        join bosses b on b.id = p.boss_id
        join party_members pm on pm.party_id = p.id
       where p.project_id = v_project and b.period = 'weekly' and not pc.cleared
         and pc.day = v_day and pc.hour = v_hour and pm.user_id = v_uid;
      exit when v_count + 1 <= v_max; -- 월간 1칸 + 주간 확정 수가 한도 이하면 끝

      v_victim := null;
      select pc.party_id into v_victim
        from party_confirmations pc
        join parties p on p.id = pc.party_id
        join bosses b on b.id = p.boss_id
        join party_members pm on pm.party_id = p.id
       where p.project_id = v_project and b.period = 'weekly' and not pc.cleared
         and pc.day = v_day and pc.hour = v_hour and pm.user_id = v_uid
       order by b.sort_order desc, p.sort_order desc
       limit 1;
      exit when v_victim is null;

      delete from party_confirmations where party_id = v_victim;
      v_removed := v_removed + 1;
    end loop;
  end loop;

  return v_removed;
end;
$$;

grant execute on function public.push_out_weekly_for_monthly(uuid) to authenticated;
