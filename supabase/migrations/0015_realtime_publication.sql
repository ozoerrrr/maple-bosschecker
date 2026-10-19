-- 0015: 변경 알림(레드닷)용 Realtime 등록
--
-- [추가 이유]
-- 스케줄 페이지의 ↻ 버튼(LiveRefreshButton)이 다른 사람이 바꾼 내용을 알려면, Supabase Realtime이
-- 아래 테이블의 변경을 보내야 한다. Supabase 기본 publication(supabase_realtime)에 테이블을 추가한다.
-- 읽기 권한(RLS)은 그대로 적용되므로 각자 볼 수 있는 행(내 그룹)의 변경만 받는다.
-- 이미 등록된 테이블은 건너뛰므로 여러 번 실행해도 안전하다.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array[
    'availability', 'next_availability', 'monthly_block', 'bosses', 'parties', 'boss_candidates',
    'party_confirmations', 'next_party_confirmations', 'party_members'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
