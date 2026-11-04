"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { api, apiDelete } from "@/lib/client-api";

export function RefundRequestForm({ itemId, reasons }: { itemId: string; reasons: string[] }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api("/refunds", { itemId, reason, detail: detail.trim() || null });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        사유
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          className="min-h-11 rounded-ui border border-line bg-surface px-3 text-[15px] font-normal"
        >
          <option value="">골라 주세요</option>
          {reasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      {reason === "기타" ? (
        <Field
          label="사유 (직접 입력)"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={500}
          required
        />
      ) : null}
      <p className="m-0 text-[14px] text-ink-2">
        환불되면 이 강의의 수강권이 끝납니다. 금액은 요청한 오늘을 기준으로 계산한 위 금액입니다.
      </p>
      <Button
        type="submit"
        variant="primary"
        disabled={busy || !reason || (reason === "기타" && !detail.trim())}
        className="self-start"
      >
        환불 요청
      </Button>
    </form>
  );
}

export function WithdrawRefundButton({ refundId }: { refundId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <button
        type="button"
        className="self-start text-[14px] text-ink-2 underline"
        onClick={() =>
          void apiDelete(`/refunds/${refundId}`).then((r) =>
            r.ok ? router.refresh() : setError(r.error.message),
          )
        }
      >
        환불 요청 거두기
      </button>
    </div>
  );
}
