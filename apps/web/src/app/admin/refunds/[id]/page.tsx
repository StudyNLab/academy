import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REFUND_TIER_LABEL } from "@aionit/core";
import { StatusDot } from "@aionit/ui";
import { formatDayTime, won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import type { RefundCalculation } from "@/server/refunds";
import { adminRefundDetail } from "@/server/refunds";
import { requireStaff } from "@/server/session";
import { REFUND_STATUS } from "../../labels";
import { RefundDecision } from "./refund-decision";

export const metadata: Metadata = { title: "환불 처리" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Calculation({ title, calc }: { title: string; calc: RefundCalculation }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4 text-[14px]">
      <h3 className="m-0 text-[16px] font-semibold">{title}</h3>
      <p className="m-0">
        {won(calc.amount)} (
        {calc.kind === "subscription"
          ? calc.tier === "full"
            ? "전액"
            : "일할 − 위약금"
          : REFUND_TIER_LABEL[calc.tier]}
        ) · 규정 {calc.ruleVersion}
      </p>
      <p className="m-0 text-ink-2">{calc.explanation}</p>
      <p className="m-0 text-ink-2">
        결제일부터 {calc.daysSincePayment}일 · {calc.used ? "이용함" : "이용 전"}
        {calc.kind === "subscription"
          ? ` · 이번 회차 ${calc.usedDays}/${calc.periodDays}일`
          : `${calc.progressPercent !== null ? ` · 진도율 ${calc.progressPercent}%` : ""} · 지난 기간 ${calc.elapsedDays}/${calc.periodDays}일`}
      </p>
    </section>
  );
}

// AD-10 환불 처리: 규정 계산(요청 때 · 지금) ➔ 승인(토스 취소) · 거절(사유)
export default async function AdminRefundDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff("operator", `/admin/refunds/${id}`);
  if (!UUID.test(id)) notFound();
  const detail = await adminRefundDetail(getDb(), id);
  if (!detail) notFound();
  const { refund, item, order, payment, user, current } = detail;
  const [label, tone] = REFUND_STATUS[refund.status];
  const requested = refund.calculation as RefundCalculation | { source: string; note: string };

  return (
    <>
      <PageTitle label="Refund" title={item.productName}>
        <StatusDot tone={tone}>{label}</StatusDot>
      </PageTitle>
      <dl className="m-0 grid grid-cols-[120px_1fr] gap-y-2.5 surface padded text-[15px]">
        <dt className="text-ink-2">회원</dt>
        <dd className="m-0">
          {user ? <Link href={`/admin/users/${user.id}`}>{user.nickname ?? "(탈퇴한 회원)"}</Link> : "-"}
        </dd>
        <dt className="text-ink-2">결제</dt>
        <dd className="m-0">
          {order.paidAt ? formatDayTime(order.paidAt) : "-"} · {won(item.paidAmount)}
          {item.discountAmount > 0 ? ` (${item.discountReason})` : ""}
          {payment && payment.canceledAmount > 0 ? ` · 이미 취소 ${won(payment.canceledAmount)}` : ""}
        </dd>
        <dt className="text-ink-2">요청</dt>
        <dd className="m-0">
          {formatDayTime(refund.createdAt)} · {refund.reason}
          {refund.reasonDetail ? ` — ${refund.reasonDetail}` : ""}
        </dd>
        {refund.decidedAt ? (
          <>
            <dt className="text-ink-2">처리</dt>
            <dd className="m-0">
              {formatDayTime(refund.decidedAt)}
              {refund.approvedAmount !== null ? ` · ${won(refund.approvedAmount)}` : ""}
              {refund.decisionNote ? ` — ${refund.decisionNote}` : ""}
            </dd>
          </>
        ) : null}
        {refund.providerCancelKey ? (
          <>
            <dt className="text-ink-2">토스 취소</dt>
            <dd className="m-0 font-mono text-[13px] break-all">{refund.providerCancelKey}</dd>
          </>
        ) : null}
      </dl>
      <div className="mt-6 flex flex-col gap-5">
        {"ruleVersion" in requested ? (
          <Calculation title="요청한 날 계산 (환불 금액 기준)" calc={requested} />
        ) : (
          <p className="m-0 text-[14px] text-ink-2">{requested.note}</p>
        )}
        {current ? <Calculation title="오늘 다시 계산 (참고)" calc={current} /> : null}
      </div>
      {refund.failMessage ? (
        <p className="mt-4 text-[14px] text-danger">지난 토스 취소 실패: {refund.failMessage}</p>
      ) : null}
      {refund.status === "requested" && payment ? (
        <RefundDecision
          refundId={refund.id}
          requestedAmount={refund.requestedAmount}
          maxAmount={Math.min(item.paidAmount, payment.amount - payment.canceledAmount)}
        />
      ) : null}
      <Link href="/admin/refunds" className="mt-8 inline-flex min-h-11 items-center">
        ← 환불 목록
      </Link>
    </>
  );
}
