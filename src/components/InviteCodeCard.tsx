"use client";

import { useState } from "react";

interface Props {
  inviteCode: string;
  members: { id: string; name: string; role: string }[];
}

export default function InviteCodeCard({ inviteCode, members }: Props) {
  const [copied, setCopied] = useState(false);

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
        <ul className="flex flex-wrap gap-2">
          {members.map((m) => (
            <li key={m.id} className="chip">
              {m.name} {m.role === "owner" && <span style={{ color: "var(--accent)" }}>★</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
