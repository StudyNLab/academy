import type { Metadata } from "next";
import Link from "next/link";
import { MonoLabel, StatusDot } from "@aionit/ui";
import { formatDay, won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { myOrders } from "@/server/commerce";
import { getDb } from "@/server/db";
import { requireViewer } from "@/server/session";

export const metadata: Metadata = { title: "결제 내역" };

const ORDER_LABEL = {
  paid: ["결제 완료", "done"],
  partially_refunded: ["부분 환불", "warn"],
  refunded: ["환불 완료", "muted"],
} as const;

// M-04 결제 내역 (화면상세기획 5장): 영수증(토스 카드 영수증) · 환불 요청 · 처리 상태
export default async function PaymentsPage() {
  const viewer = await requireViewer("/my/payments");
  const rows = await myOrders(getDb(), viewer.userId);
  return (
    <>
      <PageTitle label="Payments" title="결제 내역" />
      {rows.length === 0 ? (
        <p className="surface padded m-0 text-muted">
          아직 결제한 강의가 없습니다. <Link href="/courses">강의 목록 →</Link>
        </p>
      ) : (
        <ul className="surface m-0 flex list-none flex-col overflow-hidden p-0">
          {rows.map(({ order, item, course, payment, refunds }) => {
            const status = ORDER_LABEL[order.status as keyof typeof ORDER_LABEL] ?? ["", "muted"];
            const open = refunds.find((r) => r.status === "requested" || r.status === "approved");
            const lastRejected = !open && refunds[0]?.status === "rejected" ? refunds[0] : null;
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 border-b border-line px-7 py-6 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex flex-col gap-1">
                    <MonoLabel className="text-[11px] text-ink-2">
                      {order.paidAt ? formatDay(order.paidAt) : ""}
                    </MonoLabel>
                    <Link
                      href={course ? `/courses/${course.slug}` : "/my/subscription"}
                      className="text-[17px] font-semibold text-ink no-underline"
                    >
                      {item.productName}
                    </Link>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-[17px] font-semibold tabular-nums">{won(item.paidAmount)}</span>
                    <StatusDot tone={status[1]}>{open ? "환불 요청됨" : status[0]}</StatusDot>
                  </div>
                </div>
                {payment && payment.canceledAmount > 0 ? (
                  <p className="m-0 text-[14px] text-ink-2">환불 {won(payment.canceledAmount)}</p>
                ) : null}
                {lastRejected ? (
                  <p className="m-0 text-[14px] text-ink-2">환불 요청 거절: {lastRejected.decisionNote}</p>
                ) : null}
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
                  {payment?.receiptUrl ? (
                    <a
                      href={payment.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center"
                    >
                      영수증 ↗
                    </a>
                  ) : null}
                  {order.status === "paid" ? (
                    <Link
                      href={`/my/payments/${item.id}/refund`}
                      className="inline-flex min-h-11 items-center"
                    >
                      {open ? "환불 요청 보기" : "환불 요청"}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-6 text-[13px] leading-[1.7] text-ink-2">
        카드 영수증은 토스페이먼츠 영수증으로 보여 드립니다. 현금영수증 · 세금계산서는 준비 중입니다.
      </p>
    </>
  );
}
