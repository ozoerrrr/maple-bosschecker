-- 0013: 넥슨 풀네임 보스 이름을 웹 보스 이름으로 정리
--   "선택받은 세렌" -> "세렌", "감시자 칼로스" -> "칼로스", "최초의 대적자" -> "대적자", "찬란한 흉성" -> "흉성" 등
--
-- [변경 이유]
-- 넥슨 오픈 API는 보스 이름에 수식어를 붙인 풀네임을 돌려주는데, 웹은 그대로 저장해서
-- 보스 순서·메소표·파티 최대 인원(모두 짧은 이름 기준)이 이 보스들에 적용되지 않았다.
-- 이제 저장은 짧은 이름으로 하고, 화면에서만 풀네임으로 보여준다 (meso.ts의 displayBossName).
--
-- [규칙] 카탈로그(meso.ts BOSS_CATALOG)에 없는 이름이 " 카탈로그이름"으로 끝나면 그 카탈로그 이름으로 바꾼다
-- (여러 개가 맞으면 가장 긴 이름). 핑크빈처럼 카탈로그에 없는 보스는 그대로 둔다.
-- 같은 그룹에 짧은 이름 + 같은 난이도 보스가 이미 있으면, 풀네임 보스의 파티·후보를 그쪽으로 옮기고 풀네임 보스는 지운다.
-- 여러 번 실행해도 결과는 같다.

do $$
declare
  catalog text[] := array[
    '스우','데미안','가디언 엔젤 슬라임','루시드','윌','더스크','진 힐라','듄켈',
    '세렌','칼로스','대적자','카링','흉성','벨로나','림보','발드릭스','검은 마법사'
  ];
  r record;
  short_name text;
  target uuid;
  offset_order int;
begin
  for r in
    select id, project_id, name, difficulty from public.bosses
     where not (name = any (catalog))
  loop
    select c into short_name
      from unnest(catalog) as c
     where r.name like '% ' || c
     order by length(c) desc
     limit 1;
    continue when short_name is null;

    select b.id into target
      from public.bosses b
     where b.project_id = r.project_id and b.name = short_name
       and b.difficulty is not distinct from r.difficulty and b.id <> r.id
     limit 1;

    if target is null then
      -- 같은 보스가 없으면 이름만 바꾼다
      update public.bosses set name = short_name where id = r.id;
    else
      -- 같은 보스가 있으면 파티를 그 뒤 순번으로 옮기고, 후보는 중복이 아닌 것만 옮긴 뒤 풀네임 보스를 지운다
      select coalesce(max(sort_order) + 1, 0) into offset_order from public.parties where boss_id = target;
      update public.parties set boss_id = target, sort_order = sort_order + offset_order where boss_id = r.id;
      update public.boss_candidates c set boss_id = target
       where c.boss_id = r.id
         and not exists (select 1 from public.boss_candidates t
                          where t.boss_id = target and t.user_id = c.user_id and t.character_name = c.character_name);
      delete from public.boss_candidates where boss_id = r.id;
      delete from public.bosses where id = r.id;
    end if;
  end loop;
end $$;
