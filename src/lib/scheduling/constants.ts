// 원본 아티팩트(build_raid.py)의 DAYS/HOURS/MAX_PER_HOUR 상수를 그대로 포팅.
// 요일은 "목요일 시작" 주 단위를 쓴다 (메이플스토리 보스 초기화 기준).
export const DAYS = ["목", "금", "토", "일", "월", "화", "수"] as const;
export type Day = (typeof DAYS)[number];

export const DAY_INDEX: Record<Day, number> = DAYS.reduce(
  (acc, d, i) => ({ ...acc, [d]: i }),
  {} as Record<Day, number>
);

export const HOURS = Array.from({ length: 24 }, (_, h) => h);

export const DEFAULT_MAX_PER_HOUR = 3;

// JS Date.getDay() (0=일) -> 우리 라벨
export const JS_DAY_TO_LABEL: Day[] = ["일", "월", "화", "수", "목", "금", "토"];
