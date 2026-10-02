// 원본 아티팩트(raid_schedule.html)의 메소 테이블 + formatMeso 포팅.
// 보스 이름 -> 난이도코드 -> 1인 기준 주간 처치 수익(억 단위).
import type { Difficulty } from "./types";

export const MESO_TABLE: Record<string, Partial<Record<Difficulty, number>>> = {
  "검은마법사": { extreme: 56.8, hard: 4.65 },
  "카링": { extreme: 53.87, hard: 15.6, normal: 5.93, easy: 3.2 },
  "칼로스": { extreme: 41.04, chaos: 12.3, normal: 4.79, easy: 2.38 },
  "대적자": { extreme: 47.12, hard: 13.9, normal: 5.32, easy: 2.61 },
  "세렌": { extreme: 18.4, hard: 3.02 },
  "벨로나": { hard: 29.5, normal: 8.24, easy: 3.96 },
  "흉성": { hard: 26.78, normal: 5.76 },
  "림보": { hard: 23.85, normal: 9.95 },
  "스우": { extreme: 5.45 },
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "이지",
  normal: "노말",
  hard: "하드",
  chaos: "카오스",
  extreme: "익스트림",
};

export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "chaos", "extreme"];

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

/** 원본 formatMeso: 소수점 1자리로 반올림 + "억" 접미사. */
export function formatMeso(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1) + "억";
}
