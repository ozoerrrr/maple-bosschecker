-- ============================================================================
-- 메소 수익 계산 + 월간보스 실제 날짜 확정을 위한 증분 마이그레이션.
--
-- bosses.difficulty: 보스 이름("카링")과 별개로 난이도를 정규 컬럼으로 둔다.
-- 기존에는 넥슨에서 불러온 보스를 "카링 하드"처럼 이름에 난이도를 접어
-- 넣었는데(ImportBossesFromNexon의 displayName()), meso.ts의 MESO_TABLE은
-- 보스 이름 -> 난이도 -> 금액 구조라 이름에서 난이도를 다시 파싱해야 해서
-- 깨지기 쉬웠다. 별도 컬럼으로 분리해 조회를 안정화한다.
--
-- party_confirmations.confirmed_date는 0001_init.sql에서 이미 추가되어
-- 있으므로(월간보스용) 이 마이그레이션에서는 건드리지 않는다.
-- ============================================================================

alter table public.bosses
  add column difficulty text check (difficulty in ('easy','normal','hard','chaos','extreme'));

-- 기존 행은 전부 difficulty가 비어있는 채로 남는다(null) -- 소유자가 설정
-- 화면에서 보스별로 난이도를 지정해주면 메소 계산이 시작된다.
