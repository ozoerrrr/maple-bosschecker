// [추가] "이번주 획득 메소 / 총 메소" 표시.
// 다 모으기 전에는 획득 숫자를 "진행 중" 색(--meso-earned-progress, 확정 전 임시 색)으로,
// 100%(획득 >= 총, 총 > 0)가 되면 두 숫자 모두 기본색(주간 주황 / 월간 보라)으로 보여준다.
import { formatMeso } from "@/lib/scheduling/meso";

export default function MesoProgress({
  earned,
  total,
  tone = "orange",
}: {
  earned: number;
  total: number;
  tone?: "orange" | "purple";
}) {
  const done = total > 0 && earned >= total - 1e-9;
  const base = tone === "purple" ? "text-purple-600" : "text-orange-600";
  return (
    <span className={base}>
      <span className={done ? undefined : "meso-earned-progress"}>{formatMeso(earned)}</span> / {formatMeso(total)}
    </span>
  );
}
