"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// [추가] 그룹 관리의 "🔔 디스코드 알림" 카드 (그룹장만, project_notifications 테이블 -- 0016).
// 실제 발송은 DB가 한다: 확정·변경은 트리거, 주간 리셋(목 0시)·가능 시간 기입(정한 요일·시각)은 매시간 예약 작업.
export interface NotificationSettings {
  webhook_url: string | null;
  notify_confirm: boolean;
  notify_change: boolean;
  notify_reset: boolean;
  notify_avail: boolean;
  avail_dow: number;
  avail_hour: number;
}

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const WEBHOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//;

export default function DiscordNotificationSettings({
  projectId,
  initial,
}: {
  projectId: string;
  initial: NotificationSettings | null;
}) {
  const supabase = createClient();
  const [s, setS] = useState<NotificationSettings>(
    initial ?? {
      webhook_url: null,
      notify_confirm: true,
      notify_change: true,
      notify_reset: true,
      notify_avail: true,
      avail_dow: 3, // 기본 수요일
      avail_hour: 21, // 기본 21시
    }
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const set = <K extends keyof NotificationSettings>(k: K, v: NotificationSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));

  async function save() {
    const url = (s.webhook_url ?? "").trim();
    if (url && !WEBHOOK_RE.test(url)) {
      setMessage("디스코드 웹후크 주소가 아니에요. https://discord.com/api/webhooks/… 형식이어야 해요.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("project_notifications")
      .upsert({ project_id: projectId, ...s, webhook_url: url || null, updated_at: new Date().toISOString() });
    setSaving(false);
    setMessage(error ? `저장 실패: ${error.message}` : "저장했어요.");
  }

  async function test() {
    setMessage(null);
    const res = await fetch("/api/notify/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? "테스트 메시지를 보냈어요. 디스코드 채널을 확인해 주세요." : data.error ?? "테스트 메시지를 보내지 못했어요.");
  }

  const toggles: [keyof NotificationSettings, string, string][] = [
    ["notify_confirm", "파티 확정", "이번주 파티 시간을 처음 확정할 때 · 그 파티원 멘션"],
    ["notify_change", "확정 변경", "확정된 시간을 다른 시간으로 바꿀 때 · 그 파티원 멘션"],
    ["notify_reset", "주간 리셋", "매주 목요일 0시 \"보스 확정해 주세요~\" · 그룹원 전체 멘션"],
    ["notify_avail", "가능 시간 기입", "정한 요일·시각에 \"다음주 가능 시간 기입해 주세요~\" · 이번 주에 안 넣은 사람만 멘션"],
  ];

  return (
    <div className="card flex flex-col gap-3">
      <h2 className="font-semibold">🔔 디스코드 알림</h2>
      <p className="label">
        디스코드 채널 설정 → 연동 → 웹후크에서 만든 주소를 붙여넣어요. 멘션은 프로필에서 디스코드를 연결한 사람만
        가요(안 한 사람은 이름으로 표시).
      </p>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="https://discord.com/api/webhooks/…"
          value={s.webhook_url ?? ""}
          onChange={(e) => set("webhook_url", e.target.value)}
        />
        <button type="button" onClick={test} className="btn-secondary !px-3 !py-1 text-xs whitespace-nowrap">
          테스트 메시지
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {toggles.map(([key, label, desc]) => (
          <label key={key} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 !p-0"
              checked={s[key] as boolean}
              onChange={(e) => set(key, e.target.checked as never)}
            />
            <span>
              <strong>{label}</strong> <span className="text-xs text-slate-500">— {desc}</span>
            </span>
          </label>
        ))}
      </div>

      {/* 가능 시간 기입 알림 요일·시각 (그룹마다 다르게, 기본 수 21시) */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="label">가능 시간 기입 알림</span>
        <select value={s.avail_dow} onChange={(e) => set("avail_dow", parseInt(e.target.value, 10))} className="!py-1 text-sm">
          {DOW_LABELS.map((d, i) => (
            <option key={d} value={i}>
              {d}요일
            </option>
          ))}
        </select>
        <select value={s.avail_hour} onChange={(e) => set("avail_hour", parseInt(e.target.value, 10))} className="!py-1 text-sm">
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {h}시
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">수요일 저녁 추천 (목요일 0시에 다음주 가능 시간이 이번주로 넘어가요)</span>
      </div>

      <div className="flex items-center gap-2">
        <button disabled={saving} onClick={save} className="btn-primary self-start">
          {saving ? "저장 중…" : "저장"}
        </button>
        {message && <span className="text-xs text-slate-600">{message}</span>}
      </div>
    </div>
  );
}
