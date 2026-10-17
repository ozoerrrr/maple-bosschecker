import type { Difficulty } from "@/lib/scheduling/types";

// [추가] 난이도 배지 (레이드 시간표와 같은 모양: EASY 회색 / NORMAL 파랑 / HARD 빨강 / CHAOS 검정+노랑 / EXTREME 검정+빨강).
// 규칙: 화면 어디서든 난이도를 보여줄 때는 글자 대신 반드시 이 배지를 쓴다. 색은 globals.css의 .diff-* 클래스.
const LABEL: Record<Difficulty, string> = {
  easy: "EASY",
  normal: "NORMAL",
  hard: "HARD",
  chaos: "CHAOS",
  extreme: "EXTREME",
};

export default function DifficultyBadge({
  difficulty,
  className = "",
}: {
  difficulty: Difficulty | null | undefined;
  className?: string;
}) {
  if (!difficulty) return null;
  return <span className={`diff-badge diff-${difficulty} ${className}`.trim()}>{LABEL[difficulty]}</span>;
}
