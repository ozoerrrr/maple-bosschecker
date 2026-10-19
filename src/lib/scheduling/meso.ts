// 원본 아티팩트(raid_schedule.html)의 메소 테이블 + formatMeso 포팅.
// 보스 이름 -> 난이도코드 -> 1인 기준 주간 처치 수익(억 단위).
import type { Difficulty } from "./types";

export const MESO_TABLE: Record<string, Partial<Record<Difficulty, number>>> = {
  "검은 마법사": { extreme: 56.8, hard: 4.65 }, // [변경] 넥슨 표기와 같게 띄어쓰기
  "카링": { extreme: 53.87, hard: 15.6, normal: 5.93, easy: 3.2 },
  "칼로스": { extreme: 41.04, chaos: 12.3, normal: 4.79, easy: 2.38 },
  "대적자": { extreme: 47.12, hard: 13.9, normal: 5.32, easy: 2.61 },
  "세렌": { extreme: 18.4, hard: 3.02, normal: 1.67 }, // [추가] 노말 (레이드 시간표 기준)
  "벨로나": { hard: 29.5, normal: 8.24, easy: 3.96 },
  "흉성": { hard: 26.78, normal: 5.76 },
  "림보": { hard: 23.85, normal: 9.95 },
  "발드릭스": { normal: 13.2 }, // [추가] 레이드 시간표 최신판 기준
  "스우": { extreme: 5.45, hard: 0.489 }, // [추가] 하드 (레이드 시간표 기준)
  // [추가] 솔로 보스용 결정석 가격 (레이드 시간표 MESO_TABLE에서 그대로 옮김)
  "데미안": { hard: 0.464 },
  "루시드": { hard: 0.597 },
  "더스크": { chaos: 0.663 },
  "가디언 엔젤 슬라임": { chaos: 0.713 },
  "진 힐라": { hard: 1.0 },
  "윌": { hard: 0.732 },
  "듄켈": { hard: 0.896 },
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "이지",
  normal: "노말",
  hard: "하드",
  chaos: "카오스",
  extreme: "익스트림",
};

export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "chaos", "extreme"];

// [추가] 보스 추가 폼의 드롭다운 목록. 배열 순서가 곧 화면에 보이는 순서다
// (레이드 시간표의 SOLO_BOSS_ORDER 15개 + 발드릭스 + 월간 검은 마법사).
// period는 보스를 고르면 주기 드롭다운에 자동으로 채우는 값이다.
// 이름은 MESO_TABLE 키와 똑같이 맞춰서, 고른 보스는 항상 메소 계산이 된다.
export const BOSS_CATALOG: { name: string; period: "weekly" | "monthly" }[] = [
  { name: "스우", period: "weekly" },
  { name: "데미안", period: "weekly" },
  { name: "가디언 엔젤 슬라임", period: "weekly" },
  { name: "루시드", period: "weekly" },
  { name: "윌", period: "weekly" },
  { name: "더스크", period: "weekly" },
  { name: "진 힐라", period: "weekly" },
  { name: "듄켈", period: "weekly" },
  { name: "세렌", period: "weekly" },
  { name: "칼로스", period: "weekly" },
  { name: "대적자", period: "weekly" },
  { name: "카링", period: "weekly" },
  { name: "흉성", period: "weekly" },
  { name: "벨로나", period: "weekly" },
  { name: "림보", period: "weekly" },
  { name: "발드릭스", period: "weekly" }, // [추가]
  { name: "검은 마법사", period: "monthly" }, // [변경] 띄어쓰기
];

// [추가] 넥슨 풀네임 -> 웹 보스 이름(짧은 이름). "선택받은 세렌" -> "세렌", "감시자 칼로스" -> "칼로스".
// 카탈로그 이름과 같으면 그대로, 아니면 " 카탈로그이름"으로 끝나는지 본다(여러 개면 가장 긴 이름).
// 카탈로그에 없는 보스(핑크빈 등)는 그대로 둔다. 저장·계산(순서, 메소표, 파티 최대 인원)은 모두 이 짧은 이름 기준이다.
export function normalizeBossName(raw: string): string {
  const name = raw.trim();
  if (BOSS_CATALOG.some((b) => b.name === name)) return name;
  const match = BOSS_CATALOG.map((b) => b.name)
    .filter((n) => name.endsWith(" " + n))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? name;
}

// [추가] 화면 표시용 풀네임 (넥슨 표기). 저장·계산은 짧은 이름이고, 화면에 보여줄 때만 이 표를 거친다.
// 표에 없는 보스는 짧은 이름 그대로 보인다. 새 풀네임이 확인되면 여기 한 줄만 추가한다.
export const BOSS_DISPLAY_NAME: Record<string, string> = {
  "세렌": "선택받은 세렌",
  "칼로스": "감시자 칼로스",
  "대적자": "최초의 대적자",
  "흉성": "찬란한 흉성",
};

export function displayBossName(name: string): string {
  return BOSS_DISPLAY_NAME[name] ?? name;
}

// [변경] 보스 표시 순서 = BOSS_CATALOG 배열 순서 (레이드 시간표의 사용자 지정 SOLO_BOSS_ORDER + 발드릭스, 검은 마법사는 맨 뒤).
// 순서를 바꾸려면 BOSS_CATALOG 배열 순서만 고치면 된다.
const BOSS_ORDER = BOSS_CATALOG.map((b) => b.name);

// [추가] 보스 표시 순서 비교 함수 -- 스케줄의 보스 목록과 그룹 관리가 같은 순서를 쓴다.
// BOSS_ORDER(BOSS_CATALOG) 순서 -> 같은 보스는 쉬운 난이도 먼저 -> 표에 없는 보스는 sort_order(추가한 순서)대로 맨 뒤.
export function compareBossOrder(
  a: { name: string; difficulty: string | null; sort_order: number },
  b: { name: string; difficulty: string | null; sort_order: number }
): number {
  const idx = (n: string) => {
    const i = BOSS_ORDER.indexOf(n);
    return i === -1 ? 999 : i;
  };
  const rank = (d: string | null) => (d ? DIFFICULTIES.indexOf(d as Difficulty) : -1);
  return idx(a.name) - idx(b.name) || rank(a.difficulty) - rank(b.difficulty) || a.sort_order - b.sort_order;
}

// [추가] 그 보스에 실제로 있는 난이도만 돌려준다 (MESO_TABLE 기준, 이지→익스트림 순서).
// 표에 없는 보스(직접 입력)면 전체 난이도를 돌려준다.
export function difficultiesOf(name: string): Difficulty[] {
  const row = MESO_TABLE[name];
  return row ? DIFFICULTIES.filter((d) => row[d] != null) : DIFFICULTIES;
}

// 넥슨 오픈API가 내려주는 한글 난이도 문자열 -> Difficulty 코드.
// "노멀" 표기 변형까지 함께 받아둔다.
const NEXON_DIFFICULTY_MAP: Record<string, Difficulty> = {
  "이지": "easy",
  "노말": "normal",
  "노멀": "normal",
  "하드": "hard",
  "카오스": "chaos",
  "익스트림": "extreme",
};

const ENGLISH_DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "chaos", "extreme"];

// [고침] 넥슨 오픈 API는 실제로는 난이도를 "extreme"/"hard"/"normal"처럼
// 영문 소문자로 내려준다(한글 "익스트림" 등이 아님) -- 그걸 못 알아봐서
// normalizedDiff가 항상 null이 되고, 그 결과 (보스이름, null)로 모든 난이도가
// 한 보스 행에 뭉쳐 들어가던 버그가 있었다. 영문 코드를 1순위로 보고, 혹시
// 몰라 한글 표기도 계속 같이 받아준다.
export function normalizeNexonDifficulty(raw: string | null | undefined): Difficulty | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase() as Difficulty;
  if (ENGLISH_DIFFICULTIES.includes(lower)) return lower;
  return NEXON_DIFFICULTY_MAP[trimmed] ?? null;
}

// 옛 아티팩트(그리고 손에 익은 습관)는 보스 이름에 난이도 약자를 붙여 썼다
// ("세렌 H", "칼로스 N" 등 -- bossLabel()의 short 코드). 이제는 난이도가
// 별도 필드라서, 사람이 보스 이름 입력칸에 이렇게 옛날 습관대로 타이핑해도
// 이름에서 난이도를 떼어내 별도 필드로 돌려준다. 못 알아보면 원래 문자열을
// 그대로 이름으로 두고 난이도는 null.
const SHORT_CODE_TO_DIFFICULTY: Record<string, Difficulty> = {
  이지: "easy",
  E: "easy",
  N: "normal",
  노말: "normal",
  노멀: "normal",
  H: "hard",
  하드: "hard",
  C: "chaos",
  카오스: "chaos",
  Ex: "extreme",
  EX: "extreme",
  익스트림: "extreme",
};

export function parseTrailingDifficulty(input: string): { name: string; difficulty: Difficulty | null } {
  const trimmed = input.trim();
  const m = /^(.*\S)\s+([A-Za-z가-힣]+)$/.exec(trimmed);
  if (!m) return { name: trimmed, difficulty: null };
  const code = SHORT_CODE_TO_DIFFICULTY[m[2]] ?? NEXON_DIFFICULTY_MAP[m[2]];
  if (!code) return { name: trimmed, difficulty: null };
  return { name: m[1], difficulty: code };
}

/** 1인당 메소 (null-safe: 테이블에 없는 보스/난이도거나 인원이 0이면 null). */
export function mesoPerPerson(
  bossName: string,
  difficulty: Difficulty | null | undefined,
  memberCount: number
): number | null {
  if (!difficulty || memberCount <= 0) return null;
  const total = MESO_TABLE[bossName]?.[difficulty];
  if (total == null) return null;
  return total / memberCount;
}

// [변경] 레이드 시간표의 formatMeso와 같게: 1억 미만은 만 단위("4,640만"),
// 1억 이상은 소수 둘째 자리까지(끝자리 0 제거, "1.51억")
export function formatMeso(v: number): string {
  if (v === 0) return "0";
  if (v < 1) return Math.round(v * 10000).toLocaleString("en-US") + "만";
  return String(Math.round(v * 100) / 100) + "억";
}
