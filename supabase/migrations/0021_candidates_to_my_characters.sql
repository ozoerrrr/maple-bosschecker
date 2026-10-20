-- 0021: 후보 캐릭터를 "내 캐릭터"로 한 번 옮기기
--
-- [추가 이유]
-- 메소 카드가 이제 내 캐릭터(extra_characters)만 보여준다 (파티·후보 캐릭터는 넥슨 동기화로 조회에 성공해야 들어옴).
-- 후보 캐릭터(boss_candidates)는 본인이 넥슨에서 불러와 등록한 캐릭터라, 예전에 등록한 후보가
-- 메소 카드에서 갑자기 사라지지 않도록 그룹원별로 extra_characters에 한 번 복사해 둔다.
-- 파티에만 들어간 캐릭터(운영자가 직접 입력했을 수 있음)는 옮기지 않는다.
-- 이미 있는 캐릭터는 건너뛰고, 그룹에서 나간 사람의 후보는 옮기지 않는다. 여러 번 실행해도 안전하다.

insert into public.extra_characters (project_id, user_id, character_name)
select distinct c.project_id, c.user_id, btrim(c.character_name)
  from public.boss_candidates c
  join public.project_members m on m.project_id = c.project_id and m.user_id = c.user_id
 where btrim(coalesce(c.character_name, '')) <> ''
on conflict (project_id, user_id, character_name) do nothing;
