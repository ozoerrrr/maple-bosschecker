# 레이드 스케줄러 (멀티테넌트 웹 버전)

원래 Claude Artifact 한 장(`raid_schedule.html`, 자기 자신을 통째로 다시
발행하는 "퀸" 패턴)으로 만들었던 보스 파티 스케줄러를, **누구나 git에
올려서 배포하고, 그룹마다 빈 프로젝트로 시작해서 자기 보스 명단을 직접
채워 넣을 수 있는** 일반적인 웹 앱으로 다시 만든 것입니다.

- **프레임워크**: Next.js 14 (App Router) + TypeScript
- **백엔드**: Supabase (Postgres + Auth + RLS) 하나로 DB와 로그인을 동시에 처리
- **로그인**: 구글 OAuth (Supabase Auth)
- **넥슨 연동**: 그룹원 각자 자기 넥슨 오픈 API 개인 키를 등록해서 캐릭터
  닉네임/월드를 자동으로 연동 (아래 "넥슨 연동 방식" 참고)
- **배포**: 하나의 앱 인스턴스에서 여러 그룹이 각자 프로젝트(워크스페이스)를
  만들어 쓰는 구조 (그룹마다 따로 배포할 필요 없음)

## 아키텍처 요약

원본 아티팩트의 `STATE` 단일 JSON 블록을 정규화된 테이블로 나눴습니다.
자세한 대응 관계는 `supabase/migrations/0001_init.sql` 맨 위 주석을 보세요.

| 원본 (STATE 필드) | 여기서는 |
|---|---|
| `STATE.avail[uid]` | `availability` 테이블 |
| `STATE.nextAvail[uid]` | `next_availability` 테이블 |
| `STATE.confirmed` / `STATE.cleared` | `party_confirmations` 테이블 |
| `STATE.nextConfirmed` | `next_party_confirmations` 테이블 |
| `STATE.monthlyBlock` | `monthly_block` 테이블 |
| 하드코딩된 `BOSS_ORDER` | `bosses` 테이블 (프로젝트별 커스텀, `sort_order`로 재배치) |
| `RAW_PARTIES` + overrides/removed/extra + "예약된 변경사항" | `parties` / `party_members` 테이블 (바로 CRUD, 예약 개념 불필요) |

스케줄링 핵심 로직(겹치는 시간 계산, 시간당 3개 캡, 확정 재검증 등)은
`src/lib/scheduling/parties.ts`에 **원본 `build_raid.py`의 함수들을 그대로
포팅**해뒀습니다 (`lockCount`, `candidateSlots`, `reconcileConfirmed` 등).

## 빠른 시작

```bash
npm install
cp .env.example .env.local   # 아래 "환경변수" 채우기
npm run dev                   # http://localhost:3000
```

## Supabase 프로젝트 설정

1. [supabase.com](https://supabase.com)에서 새 프로젝트 생성
2. `Project Settings > API`에서 URL, anon key, service_role key 복사 → `.env.local`
3. SQL Editor에서 `supabase/migrations/0001_init.sql` 전체 실행
   (또는 Supabase CLI: `supabase db push`)
4. `Authentication > Providers > Google` 활성화하고 Google Cloud Console에서
   발급한 Client ID/Secret 등록, 리디렉션 URL은
   `https://<프로젝트>.supabase.co/auth/v1/callback`
5. `Authentication > URL Configuration`에 배포할 사이트 URL과
   `<사이트 URL>/auth/callback`을 Redirect URLs로 추가

## 환경변수 (`.env.local`)

`.env.example` 참고. 핵심은:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`: 클라이언트에서도 쓰임
- `SUPABASE_SERVICE_ROLE_KEY`: 서버 전용, 절대 노출 금지
- `NEXON_KEY_ENCRYPTION_SECRET`: 사용자가 등록하는 넥슨 API 키를 암호화해서
  저장하는 데 쓰는 서버 전용 비밀키 (`openssl rand -base64 32`로 생성)

## 넥슨 연동 방식 (중요)

넥슨은 일반 외부 개발자에게 "구글 로그인"처럼 쓸 수 있는 소비자용 OAuth를
제공하지 않습니다. 대신 각 사용자가 [openapi.nexon.com](https://openapi.nexon.com/)에서
**개인 API 키**를 발급받을 수 있는데, 이 프로젝트는 그 방식을 그대로
활용합니다:

1. 그룹원이 `/profile`에서 자기 넥슨 오픈 API 키 + 캐릭터 닉네임을 입력
2. 서버(`/api/nexon/link`)가 그 키로 넥슨 API를 호출해 실제 존재하는
   캐릭터인지 확인하고, 닉네임/월드 정보를 프로필에 채워 넣음
3. API 키 원문은 AES-256-GCM으로 암호화해서 저장하고, 본인도 다시
   조회할 수 없음 (쓰기 전용)

**실제 로그인(계정 소유권 인증)은 여전히 구글 OAuth가 담당**합니다. 넥슨
연동은 "이 사람이 어떤 캐릭터를 하는지"를 그룹 내에서 자동으로 보여주는
편의 기능이라고 이해하면 됩니다.

> 넥슨 오픈 API 엔드포인트 경로(`src/lib/nexon/client.ts`)는 넥슨 쪽 문서가
> 바뀌면 같이 바뀔 수 있어요. 배포 전에
> https://openapi.nexon.com/game/maplestory 최신 문서와 한 번 대조해보세요.

## 그룹 사용 흐름

1. 아무나 로그인 후 "빈 그룹 만들기" → 보스/파티가 하나도 없는 빈
   프로젝트 생성, 자동으로 초대코드 발급
2. 그룹장이 `/p/[프로젝트]/settings`에서 보스 추가(이름 + 주간/월간) →
   보스마다 파티 추가(파티 이름 + 멤버 선택)
3. 그룹원들이 초대코드로 참여 (`project_members`에 추가됨)
4. 각자 `/p/[프로젝트]`에서 요일×시간 그리드로 가능 시간 체크
5. 파티별로 전원이 겹치는 시간 후보가 자동 계산되어 드롭다운에 뜨고,
   하나를 골라 확정 → 완료되면 "완료" 처리

## 한계 및 다음 단계 (정직하게 밝혀둡니다)

원본 아티팩트가 몇 주에 걸쳐 다듬은 세세한 UX(요일별 드래그 선택, 달력
보기, 보스별 아코디언, "내 스케줄" 캐릭터별 뷰 등)를 전부 그대로 옮기진
못했습니다. 이 프로젝트는 **핵심 스케줄링 로직 + 멀티테넌트 구조 +
로그인 + 커스텀 보스명단**이 실제로 동작하는 탄탄한 뼈대이고, 아래는
알려진 단순화 지점입니다:

- **월간보스**: 원본은 실제 달력 날짜(이번달/다음달)로 확정하지만, 여기선
  단순화를 위해 주간보스와 동일하게 "요일 반복" 방식으로 확정합니다.
  실제 날짜 기반으로 바꾸려면 `PartyCard.tsx`에서 월간보스일 때
  `confirmed_date` 컬럼(스키마엔 이미 있음)을 쓰도록 분기하면 됩니다.
- **가능 시간 그리드**: 클릭 토글만 있고, 원본의 드래그 다중 선택은 없습니다.
- **주간 자동 리셋**(목요일 0시에 다음주 미리입력 → 이번주로 승격)은 DB
  스키마(`projects.week_state_for`)만 준비되어 있고, 실제로 승격시키는
  로직(서버 액션 또는 Supabase Edge Function + cron)은 아직 연결 안 됨.
- 실시간 동기화는 "누가 바꾸면 새로고침해야 보임" 수준입니다. Supabase
  Realtime 구독을 붙이면 원본처럼 거의 즉시 반영되게 만들 수 있어요.

## 배포 (Vercel 예시)

```bash
npm i -g vercel   # 또는 Vercel 대시보드에서 이 레포를 Import
vercel
```

Vercel 프로젝트 설정의 Environment Variables에 `.env.example`과 동일한
키들을 등록하고, `NEXT_PUBLIC_SITE_URL`은 실제 배포 도메인으로 설정하세요.
