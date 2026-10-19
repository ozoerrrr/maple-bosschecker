"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// [추가] 변경 알림 + 새로고침 버튼 (그룹 이름 옆, 스케줄 페이지에서만 보임).
// 스케줄 페이지가 열려 있는 동안 Supabase Realtime으로 우리 그룹 데이터 변경을 지켜보다가,
// 다른 사람이 바꾸면 버튼에 빨간 점(레드닷)을 켠다. 누르면 최신 데이터로 다시 그리고 점을 끈다.
// 화면을 저절로 바꾸지는 않는다 (드롭다운을 고르던 중에 값이 바뀌는 문제를 막기 위해).
// Realtime이 이 테이블들을 보내려면 0015 마이그레이션(supabase_realtime publication 등록)이 필요하다.

// 내가 방금 저장해서 생긴 변경은 점을 켜지 않는다: 저장 후 화면을 다시 그릴 때 markLocalChange()를 부르면
// 그 뒤 잠깐(LOCAL_GRACE_MS) 들어오는 변경은 무시한다. (삭제 이벤트에는 누가 했는지 정보가 없어서 시간으로 구분)
const LOCAL_EVENT = "bosschecker:local-change";
const LOCAL_GRACE_MS = 3000;
export function markLocalChange(graceMs = LOCAL_GRACE_MS) {
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: graceMs }));
}

// project_id 컬럼이 있어서 그룹으로 거를 수 있는 테이블
const PROJECT_TABLES = ["availability", "next_availability", "monthly_block", "bosses", "parties", "boss_candidates"];
// project_id가 없어 party_id로 거르는 테이블
const PARTY_TABLES = ["party_confirmations", "next_party_confirmations", "party_members"];

type Row = { user_id?: string; confirmed_by?: string; party_id?: string; id?: string } | null;

export default function LiveRefreshButton({ projectId, currentUserId }: { projectId: string; currentUserId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const onSchedulePage = pathname === `/p/${projectId}`;
  const [dirty, setDirty] = useState(false);
  const suppressUntil = useRef(0);
  const partyIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    function onLocal(e: Event) {
      const grace = (e as CustomEvent<number>).detail ?? LOCAL_GRACE_MS;
      suppressUntil.current = Math.max(suppressUntil.current, Date.now() + grace);
    }
    window.addEventListener(LOCAL_EVENT, onLocal);
    return () => window.removeEventListener(LOCAL_EVENT, onLocal);
  }, []);

  useEffect(() => {
    if (!onSchedulePage) return;
    const supabase = createClient();
    let cancelled = false;

    // 우리 그룹 파티 id 목록 (party_id로만 거를 수 있는 테이블용)
    supabase
      .from("parties")
      .select("id")
      .eq("project_id", projectId)
      .then(({ data }) => {
        if (!cancelled) partyIds.current = new Set((data ?? []).map((p: { id: string }) => p.id));
      });

    function handle(table: string, payload: { new: Row; old: Row }) {
      const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) ?? {};
      if (PARTY_TABLES.includes(table) && row.party_id && !partyIds.current.has(row.party_id)) return; // 다른 그룹
      if (table === "parties" && payload.new?.id) partyIds.current.add(payload.new.id);
      if (row.user_id === currentUserId || row.confirmed_by === currentUserId) return; // 내가 한 변경
      if (Date.now() < suppressUntil.current) return; // 방금 내가 저장한 직후
      setDirty(true);
    }

    let channel = supabase.channel(`project-live-${projectId}`);
    for (const table of PROJECT_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
        (payload) => handle(table, payload as unknown as { new: Row; old: Row })
      );
    }
    for (const table of PARTY_TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) =>
        handle(table, payload as unknown as { new: Row; old: Row })
      );
    }
    channel.subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [onSchedulePage, projectId, currentUserId]);

  if (!onSchedulePage) return null;

  function reload() {
    markLocalChange();
    setDirty(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={reload}
      className="help-btn"
      aria-label={dirty ? "다른 사람이 바꾼 내용이 있어요. 최신 내용 불러오기" : "최신 내용 불러오기"}
      data-tip={dirty ? "바뀐 내용이 있어요 · 불러오기" : "최신 내용 불러오기"}
    >
      ↻
      {dirty && <span className="live-dot" aria-hidden="true" />}
    </button>
  );
}
