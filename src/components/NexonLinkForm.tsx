"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  linkedCharacterName: string | null;
  linkedWorldName: string | null;
}

export default function NexonLinkForm({ linkedCharacterName, linkedWorldName }: Props) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/nexon/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey, characterName }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "연동에 실패했어요.");
      return;
    }
    setApiKey("");
    setCharacterName("");
    router.refresh();
  }

  async function handleUnlink() {
    setLoading(true);
    await fetch("/api/nexon/link", { method: "DELETE" });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="card flex flex-col gap-3">
      <h2 className="font-semibold">넥슨 캐릭터 연동</h2>
      <p className="text-xs text-slate-500">
        본인의 넥슨 오픈 API 개인 키(
        <a className="underline" href="https://openapi.nexon.com/" target="_blank" rel="noreferrer">
          openapi.nexon.com
        </a>
        에서 개별 발급)와 캐릭터 닉네임을 입력하면, 실제 존재하는 캐릭터인지 확인하고 닉네임/월드를
        프로필에 표시해줘요. 키는 암호화되어 저장되고 본인도 다시 조회할 수 없어요.
      </p>

      {linkedCharacterName ? (
        <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm dark:bg-brand-900/30">
          <span>
            연동됨: <b>{linkedCharacterName}</b> ({linkedWorldName})
          </span>
          <button onClick={handleUnlink} disabled={loading} className="text-xs text-red-500 underline">
            연동 해제
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="넥슨 오픈 API 개인 키"
            type="password"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <input
            value={characterName}
            onChange={(e) => setCharacterName(e.target.value)}
            placeholder="캐릭터 닉네임"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button type="submit" disabled={loading || !apiKey || !characterName} className="btn-primary">
            {loading ? "확인 중..." : "연동하기"}
          </button>
        </form>
      )}
    </div>
  );
}
