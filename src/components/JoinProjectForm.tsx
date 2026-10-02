"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function JoinProjectForm() {
  const supabase = createClient();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("로그인이 필요해요.");
      setLoading(false);
      return;
    }

    // [고침] projects의 select RLS가 "멤버이거나 소유자"만 허용해서, 아직
    // 멤버가 아닌 사람은 초대코드로 프로젝트를 조회하는 것 자체가 막혀
    // 있었다(닭과 달걀 문제). RPC(SECURITY DEFINER)로 조회+가입을 원자적으로
    // 처리한다 -- Database 타입에 커스텀 함수 시그니처가 없어서 as any 캐스트.
    const { data: projectId, error: rpcError } = await (supabase.rpc as any)(
      "join_project_by_invite_code",
      { p_invite_code: code.trim() }
    );

    if (rpcError || !projectId) {
      setError(rpcError?.message || "초대코드를 찾을 수 없어요.");
      setLoading(false);
      return;
    }

    router.push(`/p/${projectId}`);
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-3">
      <h2 className="font-semibold">초대코드로 참여하기</h2>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="초대코드 입력"
        className="input"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button type="submit" disabled={loading || !code.trim()} className="btn-secondary">
        {loading ? "참여하는 중..." : "참여하기"}
      </button>
    </form>
  );
}
