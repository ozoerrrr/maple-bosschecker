-- 0012: 보스 이름 "검은마법사" -> "검은 마법사" (띄어쓰기)
--
-- [변경 이유]
-- 넥슨 오픈 API와 넥슨에서 불러온 보스는 "검은 마법사"(띄어쓰기)를 쓰는데,
-- 메소표와 보스 드롭다운은 "검은마법사"를 써서 이름이 달라 메소가 빠지는 문제가 있었다.
-- 코드(meso.ts)를 "검은 마법사"로 바꾸면서, 이미 저장된 데이터의 이름도 같이 바꾼다.
-- 여러 번 실행해도 결과는 같다.

update public.bosses set name = '검은 마법사' where name = '검은마법사';

-- 솔로 계획·솔로 클리어 (0011 테이블. 같은 키의 행이 이미 있으면 옛 이름 행만 지운다)
update public.solo_plans s set boss_name = '검은 마법사'
 where s.boss_name = '검은마법사'
   and not exists (select 1 from public.solo_plans t
                    where t.project_id = s.project_id and t.user_id = s.user_id
                      and t.character_name = s.character_name and t.week = s.week
                      and t.boss_name = '검은 마법사');
delete from public.solo_plans where boss_name = '검은마법사';

update public.solo_clears s set boss_name = '검은 마법사'
 where s.boss_name = '검은마법사'
   and not exists (select 1 from public.solo_clears t
                    where t.project_id = s.project_id and t.user_id = s.user_id
                      and t.character_name = s.character_name and t.period_key = s.period_key
                      and t.boss_name = '검은 마법사');
delete from public.solo_clears where boss_name = '검은마법사';
