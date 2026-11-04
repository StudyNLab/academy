"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import type { BillingAuthParams } from "@/components/commerce/toss-sdk";
import { openBillingAuth } from "@/components/commerce/toss-sdk";
import { api } from "@/lib/client-api";

function useAction(subscriptionId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await api(`/subscriptions/${subscriptionId}`, body);
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    router.refresh();
  }
  return { busy, error, run, setError, setBusy };
}

/** 해지 (클릭 2번): [구독 해지] ➔ 확인 창 [해지 예약] / [계속 이용]. 사유는 선택 */
export function CancelSubscription({
  subscriptionId,
  periodEnd,
}: {
  subscriptionId: string;
  periodEnd: string | null;
}) {
  const { busy, error, run } = useAction(subscriptionId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
        구독 해지
      </Button>
    );
  return (
    <div
      role="dialog"
      aria-label="구독 해지"
      className="flex max-w-[560px] flex-col gap-4 border-t-2 border-warn bg-surface p-5"
    >
      <p className="m-0 text-[15px] leading-[1.7]">
        {periodEnd ? `${periodEnd} 까지는 지금처럼 이용할 수 있고, ` : ""}그 뒤에는 자동결제가 되지 않습니다.
        진도 기록은 지워지지 않습니다.
      </p>
      <Field
        label="사유 (선택 · 개선에 쓰겠습니다)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => void run({ action: "cancel", reason: reason || null })}
        >
          해지 예약
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          계속 이용
        </Button>
      </div>
    </div>
  );
}

export function UndoCancelButton({ subscriptionId }: { subscriptionId: string }) {
  const { busy, error, run } = useAction(subscriptionId);
  return (
    <div className="flex flex-col gap-2">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        variant="outline"
        className="self-start"
        disabled={busy}
        onClick={() => void run({ action: "undo-cancel" })}
      >
        해지 취소
      </Button>
    </div>
  );
}

export function AgreePriceButton({ subscriptionId }: { subscriptionId: string }) {
  const { busy, error, run } = useAction(subscriptionId);
  return (
    <span className="mt-2 flex flex-col gap-2">
      {error ? <span className="text-danger">{error}</span> : null}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={() => void run({ action: "agree-price" })}
      >
        새 가격에 동의
      </Button>
    </span>
  );
}

/** 결제 수단 변경: 카드 등록창 ➔ /my/subscription/card/{id} 로 돌아와 새 빌링키로 바꾼다 */
export function ChangeCardButton({ subscriptionId }: { subscriptionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick() {
    setBusy(true);
    setError(null);
    const result = await api<BillingAuthParams>(`/subscriptions/${subscriptionId}`, { action: "card-start" });
    if (!result.ok) {
      setBusy(false);
      return setError(result.error.message);
    }
    const failed = await openBillingAuth(result.data);
    if (failed) setError(failed);
    setBusy(false);
  }
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={busy}
        onClick={() => void onClick()}
        className="min-h-11 text-[14px] text-link underline"
      >
        결제 수단 변경
      </button>
      {error ? <span className="text-[13px] text-danger">{error}</span> : null}
    </span>
  );
}
