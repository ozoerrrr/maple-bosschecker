"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function DebugPage() {
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientUser, setClientUser] = useState<unknown>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      setClientUser(userData.user);

      const { data, error } = await supabase.rpc("debug_whoami");
      if (error) setError(error.message);
      else setResult(data);
    })();
  }, []);

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">디버그: 서버가 보는 나</h1>

      <div className="card">
        <p className="text-sm font-semibold mb-2">클라이언트 쪽 (브라우저) 세션</p>
        <pre className="whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(clientUser, null, 2)}
        </pre>
      </div>

      <div className="card">
        <p className="text-sm font-semibold mb-2">서버(Postgres) 쪽에서 본 auth.uid() / auth.role()</p>
        {error && <p className="text-red-500 text-sm">에러: {error}</p>}
        <pre className="whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </main>
  );
}