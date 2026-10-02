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

    const { data: project, error: lookupError } = await supabase
      .from("projects")
      .select("id")
      .eq("invite_code", code.trim())
      .maybeSingle();

    if (lookupError || !project) {
      setError("초대코드를 찾을 수 없어요.");
      setLoading(false);
      return;
    }

    const { error: joinError } = await supabase
      .from("project_members")
      .upsert({ project_id: project.id, user_id: user.id, role: "member" }, { onConflict: "project_id,user_id" });

    if (joinError) {
      setError(joinError.message);
      setLoading(false);
      return;
    }

    router.push(`/p/${project.id}`);
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
