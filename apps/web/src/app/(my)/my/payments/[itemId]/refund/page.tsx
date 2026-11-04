import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REFUND_TIER_LABEL } from "@aionit/core";
import { Notice } from "@aionit/ui";
import { formatDay, formatDayTime, won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { CommerceError } from "@/server/commerce";
import { getDb } from "@/server/db";
import { REFUND_REASONS, refundQuote } from "@/server/refunds";
import { requireViewer } from "@/server/session";
import { RefundRequestForm, WithdrawRefundButton } from "./refund-form";

export const metadata: Metadata = { title: "환불 요청" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASIS_LABEL = {
  cooling_off: "결제일부터 7일 이내 · 이용 전",
  not_started: "늘어난 기간이 아직 시작되지 않음",
  progress: "진도율과 기간 중 높은 쪽 = 진도율",
  elapsed: "진도율과 기간 중 높은 쪽 = 지난 기간",
} as const;

// M-04 환불 요청 (화면상세기획 5장): 예상 환불액을 먼저 보여 주고, 환불 불가 구간이면 버튼 대신 이유
export default async function RefundPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const viewer = await requireViewer(`/my/payments/${itemId}/refund`);
  if (!UUID.test(itemId)) notFound();
  const view = await refundQuote(getDb(), viewer.userId, itemId).catch((error: unknown) => {
    if (error instanceof CommerceError && error.status === 404) notFound();
    throw error;
  });
  const { item, order, quote } = view;
  const open = view.refunds.find((r) => r.status === "requested" || r.status === "approved");
  const calc = quote.calculation ?? null;

  return (
    <>
      <PageTitle
        label="Refund"
        title={`${item.productType === "subscription" ? "즉시 해지 · 환불" : "환불 요청"} · ${item.productName}`}
      >
        {item.productType === "subscription"
          ? "환불되면 구독이 바로 끝나고 자동결제가 멈춥니다. 이번 회차 끝까지 이용하려면 구독 관리에서 해지 예약을 하세요."
          : null}
      </PageTitle>
      <dl className="m-0 grid grid-cols-[120px_1fr] gap-y-2.5 border-t-2 border-line-strong pt-5 text-[15px]">
        <dt className="text-ink-2">결제일</dt>
        <dd className="m-0">{order.paidAt ? formatDay(order.paidAt) : "-"}</dd>
        <dt className="text-ink-2">결제 금액</dt>
        <dd className="m-0 tabular-nums">{won(item.paidAmount)}</dd>
        {calc?.kind === "subscription" ? (
          <>
            <dt className="text-ink-2">이번 회차</dt>
            <dd className="m-0">
              {calc.usedDays}일 지남 · {calc.remainingDays}일 남음 (전체 {calc.periodDays}일)
              {calc.used ? "" : " · 이번 회차 학습 전"}
            </dd>
            <dt className="text-ink-2">계산</dt>
            <dd className="m-0">{calc.explanation}</dd>
          </>
        ) : calc ? (
          <>
            <dt className="text-ink-2">지난 기간</dt>
            <dd className="m-0">
              {calc.elapsedDays}일 / {calc.periodDays}일 ({calc.elapsedPercent}%)
            </dd>
            {calc.progressPercent !== null ? (
              <>
                <dt className="text-ink-2">진도율</dt>
                <dd className="m-0">
                  {calc.progressPercent}% {calc.used ? "" : "· 아직 이용 전"}
                </dd>
              </>
            ) : null}
            <dt className="text-ink-2">적용 기준</dt>
            <dd className="m-0">
              {BASIS_LABEL[calc.basis]}
              {calc.basis === "progress" || calc.basis === "elapsed" ? ` = ${calc.basisPercent}%` : ""}
            </dd>
          </>
        ) : null}
      </dl>

      {open ? (
        <div className="mt-6 flex flex-col gap-4">
          <Notice tone="info" title={`환불을 요청했습니다 (${formatDayTime(open.createdAt)})`}>
            요청 금액 {won(open.requestedAmount)}. 운영자가 확인한 뒤 원래 결제 수단으로 돌려드리고 메일로
            알려 드립니다.
          </Notice>
          {open.status === "requested" ? <WithdrawRefundButton refundId={open.id} /> : null}
        </div>
      ) : quote.ok ? (
        <>
          <div className="mt-6 border-t border-line pt-5">
            <p className="m-0 text-[15px] text-ink-2">예상 환불액</p>
            <p className="m-0 mt-1 text-[30px] font-semibold tabular-nums tracking-[-0.03em]">
              {won(quote.calculation.amount)}{" "}
              <span className="text-[16px] font-normal text-ink-2">
                (
                {quote.calculation.kind === "subscription"
                  ? quote.calculation.tier === "full"
                    ? "전액"
                    : "남은 기간 일할 − 위약금 10%"
                  : REFUND_TIER_LABEL[quote.calculation.tier]}
                )
              </span>
            </p>
          </div>
          <RefundRequestForm itemId={item.id} reasons={[...REFUND_REASONS]} />
        </>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          <Notice tone="warn">
            {quote.message} <Link href="/policies/refund">환불 규정</Link>
          </Notice>
          <p className="m-0 text-[14px] text-ink-2">
            사정이 있으면{" "}
            <Link href={`/my/inquiries/new?category=${encodeURIComponent("결제 · 환불")}`}>1:1 문의</Link>로
            알려 주세요.
          </p>
        </div>
      )}
      <Link href="/my/payments" className="mt-8 inline-flex min-h-11 items-center">
        ← 결제 내역
      </Link>
    </>
  );
}
