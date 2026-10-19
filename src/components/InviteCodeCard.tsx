"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  projectId: string; // [추가] 0018: 직책 지정(set_member_role)용
  inviteCode: string;
  members: { id: string; name: string; role: string; discordLinked?: boolean }[]; // [추가] discordLinked
}

export default function InviteCodeCard({ projectId, inviteCode, members }: Props) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // [추가] 0018: 운영자가 멤버 <-> 부운영자를 바꾼다 (이 카드는 운영자에게만 보인다)
  function setRole(userId: string, role: "manager" | "member") {
    startTransition(async () => {
      const { error } = await createClient().rpc("set_member_role", { p_project_id: projectId, p_user_id: userId, p_role: role });
      if (error) alert(`직책을 바꾸지 못했어요: ${error.message}`);
      router.refresh();
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 권한이 없으면 그냥 무시 -- 코드가 화면에 보이니 수동 복사 가능
    }
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">초대코드</h2>
        <button onClick={copy} className="btn-secondary !px-3 !py-1 text-xs">
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
      <code className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--surface2)" }}>
        {inviteCode}
      </code>
      <div>
        <h3 className="eyebrow mb-1">멤버 ({members.length})</h3>
        {/* [추가] 0018 */}
        <p className="sub mb-2 text-xs">★ 운영자 · 부운영자는 보스 파티를 편집하고 모든 파티의 시간을 확정·클리어할 수 있어요.</p>
        <ul className="flex flex-wrap gap-2">
          {members.map((m) => (
            <li key={m.id} className="chip">
              {m.name} {m.role === "owner" && <span style={{ color: "var(--accent)" }}>★</span>}
              {/* [추가] 0018: 부운영자 표시 */}
              {m.role === "manager" && <span className="text-[10px] font-bold text-sky-600">부운영자</span>}
              {/* [추가] 디스코드를 연결하지 않은 멤버 표시 (디스코드 알림 멘션을 못 받음) */}
              {m.discordLinked === false && <span className="text-[10px] font-semibold text-slate-400">디코 미연동</span>}
              {/* [추가] 0018: 직책 바꾸기 (운영자 본인 제외) */}
              {m.role !== "owner" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setRole(m.id, m.role === "manager" ? "member" : "manager")}
                  className="text-[10px] text-slate-500 underline"
                >
                  {m.role === "manager" ? "멤버로" : "부운영자로"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
