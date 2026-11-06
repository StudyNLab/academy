"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@aionit/ui";
import { lastDay, won } from "@/components/commerce/format";
import { SvcIcon } from "@/components/icons";
import { ResultPage } from "@/components/result-page";
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
      <ResultPage
        status
        eyebrow="PAYMENT"
        title="결제를 확인하고 있습니다…"
        desc="이 화면을 닫지 말고 잠시 기다려 주세요."
      />
    );

  if (state.kind === "failed")
    return (
      <ResultPage
        eyebrow="PAYMENT RESULT"
        title="결제를 마치지 못했습니다"
        desc="다시 시도하기 전에 아래 내용을 확인해 주세요."
        mark="fail"
        heading="결제가 승인되지 않았습니다"
        body={<Notice tone="danger">{state.message}</Notice>}
        actions={
          <>
            <Link href={`/checkout/${orderId}`} className="btn primary">
              다시 결제 <SvcIcon name="arrow" />
            </Link>
            <Link href="/my/payments" className="btn secondary">
              결제 내역
            </Link>
          </>
        }
      />
    );

  const { data } = state;
  return (
    <ResultPage
      eyebrow="PAYMENT RESULT"
      title="결제가 끝났습니다"
      desc="이제 내 강의실에서 배움을 시작하세요."
      mark="done"
      heading={`${data.courseTitle}${data.productType === "extension" ? " (연장)" : ""}`}
      body="영수증을 메일로 보냈습니다. 결제 내역에서도 볼 수 있습니다."
      items={[
        ["결제 금액", won(data.paidAmount)],
        ["수강 기간", data.accessUntil ? `${lastDay(new Date(data.accessUntil))} 까지` : "무제한"],
      ]}
      actions={
        <>
          <Link href={`/learn/${data.courseSlug}`} className="btn primary">
            바로 학습하기 <SvcIcon name="arrow" />
          </Link>
          <Link href="/my/payments" className="btn secondary">
            결제 내역
          </Link>
        </>
      }
    />
  );
}
