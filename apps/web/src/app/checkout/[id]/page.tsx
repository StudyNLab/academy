import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, Notice } from "@aionit/ui";
import { BuyButton } from "@/components/commerce/buy-button";
import { lastDay, periodLabel, won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { checkoutView, CommerceError, tossCustomerKey } from "@/server/commerce";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { fakeMode } from "@/server/payments";
import { requireViewer } from "@/server/session";
import { CheckoutForm } from "./checkout-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className={strong ? "font-semibold" : "text-ink-2"}>{label}</dt>
      <dd className={`m-0 tabular-nums ${strong ? "text-[22px] font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

// C-01 주문서 (화면상세기획 3.1): 상품 · 수강 기간 · 정가 · 할인 · 결제 금액 · 환불 규정 요약 + 동의 ➔ 토스 결제창
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer(`/checkout/${id}`);
  if (!UUID.test(id)) notFound();
  const view = await checkoutView(getDb(), viewer, id).catch((error: unknown) => {
    if (error instanceof CommerceError && error.status === 404) notFound();
    throw error;
  });
  const { order, item, course } = view;
  const isExtension = item.productType === "extension";
  const env = getEnv();

  if (order.status !== "pending") {
    return (
      <>
        <PageTitle label="Order" title="이미 끝난 주문입니다" />
        <div className="flex flex-wrap gap-4">
          <Link href="/my/payments" className={buttonClass("primary", "md")}>
            결제 내역 보기
          </Link>
          <Link href={`/courses/${course.slug}`} className={buttonClass("outline", "md")}>
            강의 안내
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle label="Checkout" title="주문서" />
      {view.expired ? (
        <div className="mb-8 flex flex-col gap-4">
          <Notice tone="warn" title="주문서를 연 지 30분이 지났습니다">
            그 사이 가격이 바뀌었을 수 있어 주문서를 새로 만들어야 합니다.
          </Notice>
          <BuyButton
            productId={item.productId}
            label="주문서 새로 만들기"
            loggedIn
            returnTo={`/courses/${course.slug}`}
            size="md"
            className="self-start"
          />
        </div>
      ) : null}
      <dl className="m-0 border-t-2 border-line-strong pt-4 text-[15px]">
        <Row label="상품" value={item.productName} />
        <Row
          label={isExtension ? "연장" : "수강"}
          value={
            isExtension
              ? `${periodLabel(item.accessDays)} 늘림${view.accessUntil ? ` (${lastDay(view.accessUntil)} 까지)` : ""}`
              : item.accessDays
                ? `결제일부터 ${periodLabel(item.accessDays)}${view.accessUntil ? ` (${lastDay(view.accessUntil)} 까지)` : ""}`
                : "무제한"
          }
        />
      </dl>
      <dl className="m-0 mt-4 border-t border-line pt-4 text-[15px]">
        <Row label="정가" value={won(item.listPrice)} />
        {item.discountAmount > 0 ? (
          <Row label={item.discountReason ?? "할인"} value={`−${won(item.discountAmount)}`} />
        ) : null}
        <Row label="결제 금액" value={won(item.paidAmount)} strong />
        <p className="m-0 text-right text-[13px] text-ink-2">
          (공급가액 {won(item.supplyAmount)} · 부가세 {won(item.vatAmount)})
        </p>
      </dl>
      <section className="mt-6 border-t border-line pt-4 text-[14px] leading-[1.75]">
        <h2 className="m-0 mb-2 text-[16px] font-semibold">환불 규정 요약</h2>
        <ul className="m-0 list-none p-0 text-ink-2">
          {isExtension ? (
            <>
              <li>· 늘어난 기간이 시작되기 전: 전액</li>
              <li>· 시작된 뒤: 늘어난 기간 중 지난 비율 1/3 미만 2/3 · 1/2 미만 1/2 · 이후 없음</li>
            </>
          ) : (
            <>
              <li>· 7일 이내 + 이용 전: 전액</li>
              <li>· 진도 · 기간 1/3 미만: 2/3 · 1/2 미만: 1/2 · 이후: 없음</li>
              <li>· 수강생 전용 영상을 재생하거나 실습 파일을 받으면 이용한 것으로 봅니다</li>
            </>
          )}
        </ul>
        <Link href="/policies/refund" target="_blank" className="mt-2 inline-flex min-h-11 items-center">
          전문 보기{view.refundPolicy ? ` (${view.refundPolicy.version})` : ""} →
        </Link>
      </section>
      {!view.expired && (fakeMode() || env.TOSS_CLIENT_KEY) ? (
        <CheckoutForm
          orderId={order.id}
          amount={item.paidAmount}
          clientKey={env.TOSS_CLIENT_KEY ?? ""}
          customerKey={tossCustomerKey(env.BETTER_AUTH_SECRET, viewer.userId)}
          testMode={fakeMode() || (env.TOSS_CLIENT_KEY ?? "").startsWith("test_")}
          fake={fakeMode()}
        />
      ) : null}
    </>
  );
}
