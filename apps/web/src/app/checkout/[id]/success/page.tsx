import type { Metadata } from "next";
import { requireViewer } from "@/server/session";
import { ConfirmPayment } from "./confirm-payment";

export const metadata: Metadata = { title: "결제 완료" };

// C-03 결제 완료: 토스 결제창이 paymentKey · orderId · amount 를 붙여 이 주소로 돌려보낸다.
// 승인(쓰기)은 화면이 API 로 요청한다 (docs/기술설계.md 2.1: 바뀌는 일은 API 로만)
export default async function CheckoutSuccess({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireViewer(`/checkout/${id}`);
  return (
    <ConfirmPayment
      orderId={id}
      paymentKey={query.paymentKey ?? ""}
      returnedOrderId={query.orderId ?? ""}
      amount={Number(query.amount ?? NaN)}
    />
  );
}
