import type { Metadata } from "next";
import Link from "next/link";
import { billingDateOf, discountAt, kstDate } from "@aionit/core";
import { schema } from "@aionit/db";
import { liveSubscription, subscriptionPlans } from "@aionit/payments";
import { won } from "@/components/commerce/format";
import { COVER } from "@/components/catalog-card";
import { SvcIcon } from "@/components/icons";
import { FIELD_LABEL, listCatalog } from "@/server/catalog";
import { getDb } from "@/server/db";
import { billingEnabled } from "@/server/payments";
import { getViewer } from "@/server/session";
import { SubscribeForm } from "./subscribe-form";

export const metadata: Metadata = { title: "구독" };

const longDay = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" });

// P-05 구독 안내 + C-04 구독 신청 (화면상세기획 3.2, 시안 #/subscribe · #/subscribe/apply): 요금제 · 포함 강의 · 프리미엄 할인 · 해지 · 환불 요약,
// 자동결제 동의는 다른 동의와 따로 받는다
export default async function SubscribePage() {
  const db = getDb();
  const viewer = await getViewer();
  const now = new Date();
  const [plans, catalog, policies, live] = await Promise.all([
    subscriptionPlans(db, now),
    listCatalog(db),
    db.select().from(schema.subscriberDiscountPolicies),
    viewer ? liveSubscription(db, viewer.userId) : null,
  ]);
  const included = catalog.filter((c) => c.inSubscription);
  const premiumCount = catalog.length - included.length;
  const discount = discountAt(policies, now);
  const monthly = plans.find((p) => p.product.billingInterval === "month");
  const today = kstDate(now);

  const first = included[0];
  return (
    <div className="wrap page-main">
      <div className="breadcrumb">
        <Link href="/">홈</Link>
        <span>/</span>
        <span>구독 안내</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MEMBERSHIP</span>
          <h1>배움을 멈추지 않는 방법.</h1>
          <p>
            구독하면 구독 포함 강의를 모두 들을 수 있고, 프리미엄 강의는 할인된 가격으로 살 수 있습니다.
            해지는 가입만큼 쉽게 — 구독 관리에서 두 번 눌러 예약합니다.
          </p>
        </div>
      </div>

      {plans.length > 0 ? (
        <div className="plan-layout">
          {plans.map(({ product, price }) => {
            const yearly = product.billingInterval === "year";
            const freeMonths =
              yearly && monthly
                ? Math.floor((monthly.price.amount * 12 - price.amount) / monthly.price.amount)
                : 0;
            return (
              <article key={product.id} className={yearly ? "plan-card recommended" : "plan-card"}>
                <div className="row between">
                  <span className="eyebrow">{yearly ? "ANNUAL" : "MONTHLY"}</span>
                  {yearly && freeMonths > 0 ? <span className="tag">{freeMonths}개월 무료</span> : null}
                </div>
                <h2>{product.name}</h2>
                <div className="plan-price">
                  {price.amount.toLocaleString("ko-KR")}
                  <span>원 / {yearly ? "년" : "월"}</span>
                </div>
                <p>
                  {yearly
                    ? `월 ${won(Math.round(price.amount / 12))} · 한 해 동안 이어지는 배움.`
                    : "한 달씩 유연하게 이어가는 배움."}
                </p>
                {live ? null : (
                  <Link className="btn primary" href={viewer ? "#apply" : "/signup"}>
                    {viewer ? `${yearly ? "연간" : "월간"} 구독 신청` : "가입하고 구독하기"}{" "}
                    <SvcIcon name="arrow" />
                  </Link>
                )}
                <ul className="benefit-list">
                  <li>
                    <SvcIcon name="check" /> 구독 포함 강의 전체 학습
                  </li>
                  <li>
                    <SvcIcon name="check" /> 강의별 교재 · 영상 · 실습 · Q&amp;A
                  </li>
                  {discount && discount.ratePercent > 0 ? (
                    <li>
                      <SvcIcon name="check" /> 프리미엄 강의 {discount.ratePercent}% 할인
                    </li>
                  ) : null}
                  <li>
                    <SvcIcon name="check" /> 해지해도 결제한 기간 끝까지 이용
                  </li>
                </ul>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="surface padded text-muted">구독은 곧 열립니다.</p>
      )}

      <section className="page-section">
        <h2>포함된 강의</h2>
        {first ? (
          <div className="included-course">
            <div
              className={`catalog-art ${COVER[first.field].art}`}
              data-topic={first.field}
              aria-hidden="true"
            >
              <span>AIONIT / {FIELD_LABEL[first.field]}</span>
              <div className="cover-glyph">{COVER[first.field].glyph}</div>
            </div>
            <div>
              <span className="tag">구독 포함 {included.length}개</span>
              <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                {included.map((c) => (
                  <li key={c.id}>
                    <Link href={`/courses/${c.slug}`}>{c.title}</Link>{" "}
                    <span className="text-muted">· {c.instructor}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-muted">아직 없습니다.</p>
        )}
        {premiumCount > 0 && discount && discount.ratePercent > 0 ? (
          <p className="mt-4 text-[14px] text-muted">
            프리미엄 강의 {premiumCount}개는 구독자 {discount.ratePercent}% 할인가로 살 수 있습니다.
          </p>
        ) : null}
      </section>

      <section className="page-section narrow-copy">
        <h2>시작하기 전에 확인해 주세요.</h2>
        <details className="faq-item">
          <summary>구독을 해지하면 바로 학습이 중단되나요?</summary>
          <p>해지는 다음 자동결제를 멈추는 예약입니다. 이미 결제한 기간이 끝날 때까지 학습할 수 있습니다.</p>
        </details>
        <details className="faq-item">
          <summary>환불은 어떻게 되나요?</summary>
          <p>
            이번 회차 결제일부터 7일 이내 + 학습 전이면 전액 환불, 그 뒤 즉시 해지는 남은 날 일할 − 위약금
            10%입니다.
          </p>
          <Link className="link-line" href="/policies/refund">
            환불 정책 전문
          </Link>
        </details>
        <details className="faq-item">
          <summary>요금이 바뀌면 어떻게 되나요?</summary>
          <p>가격이 오르면 30일 전에 알리고 동의를 받습니다.</p>
        </details>
      </section>

      <section className="page-section">
        {live ? (
          <div className="surface padded flex flex-col gap-4">
            <p className="m-0 text-[19px] font-semibold">구독 중입니다 ({live.planName})</p>
            <Link href="/my/subscription" className="btn primary self-start">
              구독 관리 <SvcIcon name="arrow" />
            </Link>
          </div>
        ) : !viewer ? (
          <div className="wide-callout">
            <div>
              <h2>가입하고 구독을 시작하세요.</h2>
              <p>이메일 인증을 마치면 바로 신청할 수 있습니다.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="btn primary">
                가입하고 구독하기
              </Link>
              <Link href="/login?next=%2Fsubscribe" className="btn secondary">
                로그인
              </Link>
            </div>
          </div>
        ) : !billingEnabled() || plans.length === 0 ? (
          <p className="surface padded text-muted">구독 신청은 곧 열립니다.</p>
        ) : (
          <>
            <h2>구독 신청</h2>
            <SubscribeForm
              plans={plans.map(({ product, price }) => ({
                productId: product.id,
                name: product.name,
                interval: product.billingInterval!,
                amount: price.amount,
                nextBilling: longDay.format(
                  new Date(`${billingDateOf(today, product.billingInterval!, 2)}T12:00:00+09:00`),
                ),
              }))}
            />
          </>
        )}
      </section>
    </div>
  );
}
