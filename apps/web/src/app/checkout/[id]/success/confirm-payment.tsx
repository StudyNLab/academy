"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClass, MonoLabel, Notice } from "@aionit/ui";
import { lastDay, won } from "@/components/commerce/format";
import { api } from "@/lib/client-api";

interface Confirmed {
  orderId: string;
  courseSlug: string;
  courseTitle: string;
  productType: string;
  paidAmount: number;
  accessUntil: string | null;
}

type State = { kind: "working" } | { kind: "done"; data: Confirmed } | { kind: "failed"; message: string };

export function ConfirmPayment({
  orderId,
  paymentKey,
  returnedOrderId,
  amount,
}: {
  orderId: string;
  paymentKey: string;
  returnedOrderId: string;
  amount: number;
}) {
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    // 개발 모드에서 effect 가 두 번 돌아도 요청은 한 번 (서버도 중복 승인을 막는다)
    if (started.current) return;
    started.current = true;
    if (!paymentKey || returnedOrderId !== orderId || !Number.isInteger(amount)) {
      setState({ kind: "failed", message: "결제 정보가 올바르지 않습니다." });
      return;
    }
    void api<Confirmed>("/payments/confirm", { paymentKey, orderId, amount }).then((result) =>
      setState(
        result.ok ? { kind: "done", data: result.data } : { kind: "failed", message: result.error.message },
      ),
    );
  }, [orderId, paymentKey, returnedOrderId, amount]);

  if (state.kind === "working")
    return (
      <div className="flex flex-col gap-3" role="status">
        <MonoLabel className="text-xs text-signal">Payment</MonoLabel>
        <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em]">결제를 확인하고 있습니다…</h1>
        <p className="m-0 text-ink-2">이 화면을 닫지 말고 잠시 기다려 주세요.</p>
      </div>
    );

  if (state.kind === "failed")
    return (
      <div className="flex flex-col gap-5">
        <MonoLabel className="text-xs text-danger">Payment failed</MonoLabel>
        <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em]">결제를 마치지 못했습니다</h1>
        <Notice tone="danger">{state.message}</Notice>
        <div className="flex flex-wrap gap-4">
          <Link href={`/checkout/${orderId}`} className={buttonClass("primary", "md")}>
            다시 결제
          </Link>
          <Link href="/my/payments" className={buttonClass("outline", "md")}>
            결제 내역
          </Link>
        </div>
      </div>
    );

  const { data } = state;
  return (
    <div className="flex flex-col gap-5">
      <MonoLabel className="text-xs text-done">Payment complete</MonoLabel>
      <h1 className="m-0 text-[32px] font-semibold tracking-[-0.035em]">결제가 끝났습니다</h1>
      <dl className="m-0 grid grid-cols-[96px_1fr] gap-y-2 border-t-2 border-line-strong pt-4 text-[15px]">
        <dt className="text-ink-2">강의</dt>
        <dd className="m-0">
          {data.courseTitle}
          {data.productType === "extension" ? " (연장)" : ""}
        </dd>
        <dt className="text-ink-2">결제 금액</dt>
        <dd className="m-0 tabular-nums">{won(data.paidAmount)}</dd>
        <dt className="text-ink-2">수강 기간</dt>
        <dd className="m-0">{data.accessUntil ? `${lastDay(new Date(data.accessUntil))} 까지` : "무제한"}</dd>
      </dl>
      <p className="m-0 text-[14px] text-ink-2">
        영수증을 메일로 보냈습니다. 결제 내역에서도 볼 수 있습니다.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link href={`/learn/${data.courseSlug}`} className={buttonClass("primary", "lg")}>
          바로 학습하기
        </Link>
        <Link href="/my/payments" className={buttonClass("outline", "lg")}>
          결제 내역
        </Link>
      </div>
    </div>
  );
}
