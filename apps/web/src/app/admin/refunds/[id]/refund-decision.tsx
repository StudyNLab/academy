"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { won } from "@/components/commerce/format";
import { api } from "@/lib/client-api";

export function RefundDecision({
  refundId,
  requestedAmount,
  maxAmount,
}: {
  refundId: string;
  requestedAmount: number;
  maxAmount: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(requestedAmount));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = Number(amount) !== requestedAmount;

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await api(`/admin/refunds/${refundId}`, body);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    router.refresh();
  }

  return (
    <div className="mt-8 flex max-w-[560px] flex-col gap-4 border-t-2 border-line-strong pt-5">
      <h2 className="m-0 text-[19px] font-semibold">처리</h2>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label={`환불 금액 (원, 최대 ${won(maxAmount)})`}
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
      />
      <Field
        label={changed ? "이유 (규정 금액과 다르면 필수)" : "메모 · 거절 사유"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="m-0 text-[13px] text-ink-2">
        승인하면 바로 토스에 취소를 요청하고, 수강권을 끝낸 뒤 수강생에게 메일을 보냅니다.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={
            busy || !amount || Number(amount) < 1 || Number(amount) > maxAmount || (changed && !note.trim())
          }
          onClick={() => void send({ action: "approve", amount: Number(amount), note: note.trim() || null })}
        >
          {won(Number(amount) || 0)} 환불 승인
        </Button>
        <Button
          variant="outline"
          disabled={busy || note.trim().length < 2}
          onClick={() => void send({ action: "reject", note: note.trim() })}
        >
          거절
        </Button>
      </div>
    </div>
  );
}
