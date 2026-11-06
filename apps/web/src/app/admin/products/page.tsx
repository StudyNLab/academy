import type { Metadata } from "next";
import { discountAt } from "@aionit/core";
import { StatusDot } from "@aionit/ui";
import { formatDayTime, periodLabel, won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { adminCourseList } from "@/server/catalog";
import { adminProducts, discountPolicies } from "@/server/commerce";
import { getDb } from "@/server/db";
import { paymentsEnabled } from "@/server/payments";
import { requireStaff } from "@/server/session";
import { DiscountForm, NewPriceForm, NewProductForm, ProductStatusButton } from "./product-forms";

export const metadata: Metadata = { title: "상품 · 가격" };

const TYPE_LABEL = {
  course: "단건 강의",
  extension: "연장권",
  bundle: "패키지",
  subscription: "구독",
} as const;

// AD-07 상품 관리: 단건 상품(수강 기간) · 연장권 · 가격 버전 · 구독자 할인율. 가격은 고치지 않고 새 버전을 만든다
export default async function AdminProducts() {
  await requireStaff("operator", "/admin/products");
  const db = getDb();
  const [products, courses, policies] = await Promise.all([
    adminProducts(db),
    adminCourseList(db),
    discountPolicies(db),
  ]);
  const now = new Date();
  const discount = discountAt(policies, now);

  return (
    <>
      <PageTitle label="Products" title="상품 · 가격">
        가격을 바꾸면 새 버전이 생기고, 이미 결제한 주문과 열려 있는 주문서는 그때 가격 그대로입니다.
        {paymentsEnabled() ? "" : " (지금은 토스 키가 없어 결제가 꺼져 있습니다.)"}
      </PageTitle>

      <ul className="surface m-0 flex list-none flex-col overflow-hidden p-0 [&>li]:px-6">
        {products.map(({ product, courseTitle, current, upcoming, history }) => (
          <li key={product.id} className="flex flex-col gap-3 border-b border-line py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[13px] text-ink-2">
                  {product.type === "subscription"
                    ? `구독 요금제 · ${product.billingInterval === "year" ? "연간" : "월간"}`
                    : `${courseTitle} · ${TYPE_LABEL[product.type]}`}
                </span>
                <strong className="text-[17px] font-semibold">{product.name}</strong>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[19px] font-semibold tabular-nums">
                  {current ? won(current.amount) : "가격 없음"}
                </span>
                <StatusDot tone={product.status === "on_sale" ? "done" : "muted"}>
                  {product.status === "on_sale" ? "판매 중" : "판매 중지"}
                </StatusDot>
              </div>
            </div>
            <p className="m-0 text-[14px] text-ink-2">
              {product.type === "subscription"
                ? "구독 포함 강의 전체 (가격을 바꾸면 구독자에게 알림 · 올림은 동의 후)"
                : `${product.type === "extension" ? "늘리는 기간" : "수강 기간"} ${periodLabel(product.accessDays)}`}
              {upcoming.length > 0
                ? ` · 예약된 가격 ${upcoming.map((p) => `${won(p.amount)} (${formatDayTime(p.effectiveFrom)}부터)`).join(", ")}`
                : ""}
            </p>
            <details className="text-[14px]">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-link">
                가격 바꾸기 · 이력
              </summary>
              <div className="mt-3 grid gap-6 md:grid-cols-2">
                <NewPriceForm productId={product.id} />
                <ol className="m-0 flex list-none flex-col gap-1 p-0 text-ink-2">
                  {history.map((p) => (
                    <li key={p.id}>
                      {formatDayTime(p.effectiveFrom)} 부터 {won(p.amount)}
                      {p.id === current?.id ? " · 지금" : ""}
                    </li>
                  ))}
                </ol>
              </div>
            </details>
            <ProductStatusButton productId={product.id} status={product.status} />
          </li>
        ))}
        {products.length === 0 ? <li className="py-5 text-ink-2">아직 상품이 없습니다.</li> : null}
      </ul>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <NewProductForm courses={courses.map((c) => ({ id: c.id, title: c.title }))} />
        <DiscountForm
          current={discount?.ratePercent ?? null}
          history={policies.map((p) => ({
            id: p.id,
            rate: p.ratePercent,
            from: formatDayTime(p.effectiveFrom),
          }))}
        />
      </div>
    </>
  );
}
