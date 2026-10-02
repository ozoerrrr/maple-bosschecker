-- ============================================================================
-- 그룹(프로젝트) 삭제 기능 추가.
--
-- 0001_init.sql을 보면 모든 하위 테이블(project_members, bosses, parties,
-- party_members, availability, next_availability, monthly_block,
-- party_confirmations, next_party_confirmations)이 project_id 또는
-- (parties 경유) party_id FK에 "on delete cascade"가 걸려 있다. 그래서
-- projects 테이블에 DELETE 정책 하나만 추가하면, 소유자가 projects 행을
-- 지우는 것만으로 그룹 전체(멤버/보스/파티/가능시간/확정 내역)가 함께
-- 정리된다 -- 별도 하위 테이블 정책 추가는 필요 없음.
--
-- 넥슨 다중 캐릭터 불러오기 기능은 서버 route handler(/api/nexon/boss-schedule)
-- 쪽 변경만으로 충분해서(요청마다 여러 캐릭터명을 받아 API 키로 순회 조회),
-- 스키마 변경이 필요 없다. 파일명에 "nexon_multi"가 들어있는 건 애초
-- 계획상 두 기능을 한 마이그레이션 묶음으로 작업했기 때문.
-- ============================================================================

create policy "owner can delete project"
  on public.projects for delete
  to authenticated
  using (owner_id = auth.uid());
