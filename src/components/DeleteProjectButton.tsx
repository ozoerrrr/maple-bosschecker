"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  projectId: string;
  projectName: string;
}

// 그룹 삭제: 0001_init.sql의 모든 하위 테이블이 project_id/party_id FK에
// on delete cascade가 걸려 있어서, projects 행 하나만 지우면 멤버/보스/파티/
// 가능시간/확정 내역까지 전부 함께 정리된다. 실수 방지용으로 그룹 이름을
// 정확히 입력해야만 버튼이 활성화되게 한다.
export default function DeleteProjectButton({ projectId, projectName }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmText === projectName;

  async function handleDelete() {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    const { error } = await supabase.from("projects").delete().eq("id", projectId);
    if (error) {
      setDeleting(false);
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="clear-btn"
        style={{ borderColor: "var(--danger)", background: "var(--danger-soft)", color: "var(--danger)" }}
      >
        그룹 삭제
      </button>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{ border: "1.5px solid var(--danger)", background: "var(--danger-soft)" }}
    >
      <p className="text-xs font-bold" style={{ color: "var(--danger)" }}>
        이 작업은 되돌릴 수 없어요. 그룹의 보스, 파티, 멤버, 가능시간, 확정 내역이 모두 삭제됩니다.
      </p>
      <p className="label">
        계속하려면 그룹 이름 <b>{projectName}</b> 을(를) 아래에 정확히 입력하세요.
      </p>
      <input
        className="input"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={projectName}
        autoFocus
      />
      {error && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canDelete || deleting}
          onClick={handleDelete}
          className="btn !px-3 !py-1.5 text-xs"
          style={{
            background: "var(--danger)",
            color: "#fff",
            opacity: !canDelete || deleting ? 0.5 : 1,
          }}
        >
          {deleting ? "삭제하는 중..." : "영구히 삭제"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirmText("");
            setError(null);
          }}
          className="btn-secondary !px-3 !py-1.5 text-xs"
        >
          취소
        </button>
      </div>
    </div>
  );
}
