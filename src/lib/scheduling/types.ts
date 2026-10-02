import type { Day } from "./constants";

export type Period = "weekly" | "monthly";

export interface Boss {
  id: string;
  project_id: string;
  name: string;
  period: Period;
  sort_order: number;
}

export interface Party {
  id: string;
  project_id: string;
  boss_id: string;
  label: string | null;
  sort_order: number;
  /** party_members 조인 결과 */
  members: string[]; // user_id[]
}

export interface Slot {
  day: Day;
  hour: number;
}

export interface Confirmation {
  party_id: string;
  day: Day | null;
  hour: number | null;
  confirmed_date: string | null; // YYYY-MM-DD, 월간보스용
  cleared: boolean;
}

export interface NextConfirmation {
  party_id: string;
  day: Day | null;
  hour: number | null;
}

/** availability 테이블 행들을 user_id별로 묶은 형태: { [userId]: Slot[] } */
export type AvailabilityMap = Record<string, Slot[]>;

/** monthly_block 테이블 행들을 user_id별로 묶은 형태: { [userId]: "YYYY-MM-DD"[] } */
export type MonthlyBlockMap = Record<string, string[]>;

/** confirmed/next confirmed 를 party_id로 색인 */
export type ConfirmationMap = Record<string, Confirmation>;
export type NextConfirmationMap = Record<string, NextConfirmation>;
