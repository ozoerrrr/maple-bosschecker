"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Member {
  id: string;
  name: string;
  role: string;
}

interface Props {
  projectId: string;
  members: Member[]; // 본인 제외한, 양도 가능한 멤버 목록
}

// DB의 transfer_project_ownership(p_project_id, p_new_owner_id) RPC를 호출한다.
// security definer 함수라서 project_members.role 양쪽(현재 그룹장 -> member,
// 대상 -> owner)과 projects.owner_id를 한 번에 원자적으로 바꿔준다. 넘기면
// 본인은 더는 owner가 아니라서, 성공 시 설정 화면에서 나가진다(요청한
// role !== "owner" 리다이렉트가 새로고침 때 자연히 처리).
export default function TransferOwnershipButton({ projectId, members }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (members.length === 0) {
    return <p className="sub">아직 나 말고 다른 멤버가 없어서 양도할 대상이 없어요.</p>;
  }

  function doTransfer() {
    if (!targetId) return;
    setError(null);
    startTransition(async () => {
      // Database 타입에 커스텀 함수 시그니처가 없어서(Functions: Record<string, never>)
      // as any 캐스트가 필요함 -- 프로젝트 내 다른 rpc 호출(debug 페이지)과 동일 패턴.
      const { error: rpcError } = await (supabase.rpc as any)("transfer_project_ownership", {
        p_project_id: projectId,
        p_new_owner_id: targetId,
      });
      if (rpcError) {
        setError(rpcError.message || "양도에 실패했어요.");
        setConfirming(false);
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <button onClick={() => setOpen(true)} className="btn-secondary self-start">
          그룹장 양도
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg p-3" style={{ border: "1.5px dashed var(--danger)" }}>
          <p className="sub">양도하면 나는 즉시 일반 멤버가 되고, 그룹 설정을 다시 할 수 없어요.</p>
          <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setConfirming(false); }} className="input">
            <option value="">새 그룹장 선택</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            {!confirming ? (
              <button
                disabled={!targetId}
                onClick={() => setConfirming(true)}
                className="btn-secondary !px-3 !py-1 text-xs"
              >
                다음
              </button>
            ) : (
              <button
                disabled={isPending}
                onClick={doTransfer}
                className="btn-primary !px-3 !py-1 text-xs"
                style={{ background: "var(--danger)" }}
              >
                {isPending ? "양도 중..." : `정말 ${members.find((m) => m.id === targetId)?.name}에게 양도`}
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false);
                setTargetId("");
                setConfirming(false);
                setError(null);
              }}
              className="btn-secondary !px-3 !py-1 text-xs"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
