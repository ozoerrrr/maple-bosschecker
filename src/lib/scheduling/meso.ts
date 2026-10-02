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

export function normalizeNexonDifficulty(raw: string | null | undefined): Difficulty | null {
  if (!raw) return null;
  return NEXON_DIFFICULTY_MAP[raw.trim()] ?? null;
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
