-- 0020: 다음주 바뀌는 파티 공지 메모
--
-- [추가 이유]
-- 스케줄 페이지의 "📅 ○월 ○일(목)부터 바뀌는 파티" 공지 카드에 보스별 메모(예: "카오스 개편")를 붙인다.
-- 메모는 그룹 관리 다음주 탭에서 "다음주 따로"인 보스에 운영자·부운영자가 적는다.
-- 부운영자는 bosses 수정 권한이 없어서 set_next_note() 함수로만 쓴다.
-- 목요일 0시 리셋(weekly_reset_core)과 "이번주와 같게 되돌리기"(reset_next_roster) 때 메모를 비운다.
-- 0017·0018 다음에 실행. 여러 번 실행해도 안전하다.

alter table public.bosses add column if not exists next_note text;
do $$ begin
  alter table public.bosses add constraint bosses_next_note_len check (next_note is null or char_length(next_note) <= 100);
exception when duplicate_object then null; end $$;

-- 메모 저장 (운영자·부운영자, 빈 글자는 지움)
create or replace function public.set_next_note(p_boss_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from bosses where id = p_boss_id;
  if v_project is null then raise exception 'boss not found'; end if;
  if not public.is_project_manager(v_project) then raise exception 'only the owner or managers can edit next week notes'; end if;
  update bosses set next_note = nullif(btrim(left(coalesce(p_note, ''), 100)), '') where id = p_boss_id;
end;
$$;
revoke execute on function public.set_next_note(uuid, text) from public, anon;
grant execute on function public.set_next_note(uuid, text) to authenticated;

-- 이번주와 같게 되돌리기: 0018 내용 + 메모 비우기
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
  if not public.is_project_manager(v_project) then raise exception 'only the owner or managers can edit next week parties'; end if;
  delete from parties where boss_id = p_boss_id and week = 'next';
  update bosses set next_custom = false, next_note = null where id = p_boss_id; -- [변경 0020] 메모도 비움
end;
$$;

-- 주간 리셋: 0017 내용 + 메모 비우기
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
  -- [추가 0020] 다음주 공지 메모도 비운다
  update bosses set next_note = null where project_id = p_project_id and next_note is not null;

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
