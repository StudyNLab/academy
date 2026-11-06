import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@aionit/ui";
import { BuyButton } from "@/components/commerce/buy-button";
import { lastDay, periodLabel, won } from "@/components/commerce/format";
import { COVER } from "@/components/catalog-card";
import { SvcIcon } from "@/components/icons";
import { ResultPage } from "@/components/result-page";
import { FIELD_LABEL } from "@/server/catalog";
import { checkoutView, CommerceError, tossCustomerKey } from "@/server/commerce";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { fakeMode } from "@/server/payments";
import { requireViewer } from "@/server/session";
import { CheckoutForm } from "./checkout-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// C-01 주문서 (화면상세기획 3.1, 시안 #/checkout: 왼쪽 01 상품 · 02 결제 수단 · 03 이용 조건, 오른쪽 주문 요약): 상품 · 수강 기간 · 정가 · 할인 · 결제 금액 · 환불 규정 요약 + 동의 ➔ 토스 결제창
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

  const cover = COVER[course.field];
  const period = isExtension
    ? `${periodLabel(item.accessDays)} 늘림${view.accessUntil ? ` (${lastDay(view.accessUntil)} 까지)` : ""}`
    : item.accessDays
      ? `결제일부터 ${periodLabel(item.accessDays)}${view.accessUntil ? ` (${lastDay(view.accessUntil)} 까지)` : ""}`
      : "무제한";

  if (order.status !== "pending") {
    return (
      <ResultPage
        eyebrow="CHECKOUT"
        title="이미 끝난 주문입니다"
        desc="결제 내역에서 결과를 확인하세요."
        mark="done"
        heading={item.productName}
        actions={
          <>
            <Link href="/my/payments" className="btn primary">
              결제 내역 보기 <SvcIcon name="arrow" />
            </Link>
            <Link href={`/courses/${course.slug}`} className="btn secondary">
              강의 안내
            </Link>
          </>
        }
      />
    );
  }

  // 환불 규정 요약 (03 / 이용 조건 확인 칸에 들어간다)
  const terms = (
    <div className="policy-summary">
      <h3>환불 규정 요약</h3>
      <ul className="m-0 list-none p-0 text-[14px] leading-[1.75] text-muted">
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
      <Link href="/policies/refund" target="_blank" className="small-link">
        환불 정책 전문 보기{view.refundPolicy ? ` (${view.refundPolicy.version})` : ""}
      </Link>
    </div>
  );

  return (
    <div className="wrap page-main">
      <div className="breadcrumb">
        <Link href="/">홈</Link>
        <span>/</span>
        <Link href={`/courses/${course.slug}`}>{course.title}</Link>
        <span>/</span>
        <span>주문서</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CHECKOUT</span>
          <h1>주문서</h1>
          <p>결제 전에 상품과 이용 조건을 확인해 주세요.</p>
        </div>
      </div>
      {view.expired ? (
        <div className="mb-6 flex flex-col gap-4">
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
      <div className="checkout-layout">
        <div className="checkout-sections">
          <section className="surface padded">
            <div className="section-number">01 / 주문 상품</div>
            <div className="order-course">
              <div className={`catalog-art ${cover.art}`} data-topic={course.field} aria-hidden="true">
                <span>AIONIT / {FIELD_LABEL[course.field]}</span>
                <div className="cover-glyph">{cover.glyph}</div>
              </div>
              <div>
                <h2>{item.productName}</h2>
                <p>
                  {isExtension ? "연장" : "수강"} · {period}
                </p>
                {course.summary ? <p>{course.summary}</p> : null}
              </div>
            </div>
          </section>
          {!view.expired && (fakeMode() || env.TOSS_CLIENT_KEY) ? (
            <CheckoutForm
              orderId={order.id}
              amount={item.paidAmount}
              clientKey={env.TOSS_CLIENT_KEY ?? ""}
              customerKey={tossCustomerKey(env.BETTER_AUTH_SECRET, viewer.userId)}
              testMode={fakeMode() || (env.TOSS_CLIENT_KEY ?? "").startsWith("test_")}
              fake={fakeMode()}
              terms={terms}
            />
          ) : (
            <section className="surface padded">{terms}</section>
          )}
        </div>
        <aside className="order-summary surface">
          <span className="eyebrow">ORDER SUMMARY</span>
          <h2>{course.title}</h2>
          <p>교재 + 영상 + 실습 + 강의 Q&amp;A</p>
          <dl className="key-values">
            <div>
              <dt>정가</dt>
              <dd>{won(item.listPrice)}</dd>
            </div>
            {item.discountAmount > 0 ? (
              <div>
                <dt>{item.discountReason ?? "할인"}</dt>
                <dd>−{won(item.discountAmount)}</dd>
              </div>
            ) : null}
            <div className="total">
              <dt>결제 금액</dt>
              <dd>{won(item.paidAmount)}</dd>
            </div>
          </dl>
          <p className="field-hint">
            (공급가액 {won(item.supplyAmount)} · 부가세 {won(item.vatAmount)})
          </p>
          <div className="renewal-note">
            <strong>{isExtension ? "연장" : "수강 기간"}</strong>
            <span>{period}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
