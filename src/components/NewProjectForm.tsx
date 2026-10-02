"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// "빈 프로젝트"로 그룹을 생성한다 -- 보스/파티는 하나도 없이 시작하고,
// settings 화면에서 그룹이 직접 채워 넣는다.
export default function NewProjectForm() {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
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

    const { data: project, error: insertError } = await supabase
      .from("projects")
      .insert({ name: name.trim(), owner_id: user.id })
      .select("id")
      .single();

    if (insertError || !project) {
      setError(insertError?.message ?? "그룹 생성에 실패했어요.");
      setLoading(false);
      return;
    }

    const { error: memberError } = await supabase
      .from("project_members")
      .insert({ project_id: project.id, user_id: user.id, role: "owner" });

    if (memberError) {
      setError(memberError.message);
      setLoading(false);
      return;
    }

    router.push(`/p/${project.id}/settings`);
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-3">
      <h2 className="font-semibold">새 그룹 만들기</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="그룹 이름 (예: 메이플 보스팟)"
        className="input"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button type="submit" disabled={loading || !name.trim()} className="btn-primary">
        {loading ? "만드는 중..." : "빈 그룹 만들기"}
      </button>
    </form>
  );
}
