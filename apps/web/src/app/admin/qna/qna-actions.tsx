"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, inputClass } from "@aionit/ui";
import { api } from "@/lib/client-api";

/** AD-17 숨기기 · 다시 보이기 (사유 필수) · 신고 정리 */
export function ModerateActions({
  targetType,
  targetId,
  hidden,
  reported,
}: {
  targetType: "question" | "answer";
  targetId: string;
  hidden: boolean;
  reported: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    const result = await api("/admin/qna", { targetType, targetId, ...payload });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="sr-only">사유</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={hidden ? "다시 보이게 하는 사유" : "숨기는 사유 (작성자에게 알림)"}
            maxLength={300}
            className={inputClass}
          />
        </label>
        <Button
          size="sm"
          variant={hidden ? "outline" : "danger"}
          disabled={busy || reason.trim().length < 2}
          onClick={() => void send({ action: "moderate", hide: !hidden, reason })}
        >
          {hidden ? "다시 보이기" : "숨기기"}
        </Button>
        {reported ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void send({ action: "dismiss" })}
          >
            문제없음
          </Button>
        ) : null}
      </div>
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}
