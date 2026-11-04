import type { Metadata } from "next";
import Link from "next/link";
import { billingDateOf, discountAt, kstDate } from "@aionit/core";
import { schema } from "@aionit/db";
import { liveSubscription, subscriptionPlans } from "@aionit/payments";
import { buttonClass, MonoLabel } from "@aionit/ui";
import { won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { listCatalog } from "@/server/catalog";
import { getDb } from "@/server/db";
import { billingEnabled } from "@/server/payments";
import { getViewer } from "@/server/session";
import { SubscribeForm } from "./subscribe-form";

export const metadata: Metadata = { title: "구독" };

const longDay = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" });

// P-05 구독 안내 + C-04 구독 신청 (화면상세기획 3.2): 요금제 · 포함 강의 · 프리미엄 할인 · 해지 · 환불 요약,
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

  return (
    <div className="mx-auto max-w-[960px] px-5 pt-16 pb-16 md:px-0">
      <PageTitle label="Subscription" title="구독">
        구독하면 구독 포함 강의를 모두 들을 수 있고, 프리미엄 강의는 할인된 가격으로 살 수 있습니다. 해지는
        가입만큼 쉽게 — 구독 관리에서 두 번 눌러 예약합니다.
      </PageTitle>

      <section className="grid gap-4 border-t border-line-strong pt-6 md:grid-cols-2">
        {plans.map(({ product, price }) => {
          const yearly = product.billingInterval === "year";
          const freeMonths =
            yearly && monthly
              ? Math.floor((monthly.price.amount * 12 - price.amount) / monthly.price.amount)
              : 0;
          return (
            <div
              key={product.id}
              className="flex flex-col gap-2 border-t-2 border-primary bg-surface p-6 shadow-float"
            >
              <MonoLabel className="text-xs text-signal">{yearly ? "연간" : "월간"}</MonoLabel>
              <p className="m-0 text-[18px] font-semibold">{product.name}</p>
              <p className="m-0 text-[30px] font-semibold tabular-nums tracking-[-0.03em]">
                {won(price.amount)}{" "}
                <span className="text-[16px] font-normal text-ink-2">/ {yearly ? "년" : "월"}</span>
              </p>
              {yearly ? (
                <p className="m-0 text-[14px] text-ink-2">
                  월 {won(Math.round(price.amount / 12))}
                  {freeMonths > 0 ? ` · ${freeMonths}개월 무료` : ""}
                </p>
              ) : null}
            </div>
          );
        })}
        {plans.length === 0 ? <p className="m-0 text-ink-2">구독은 곧 열립니다.</p> : null}
      </section>

      <section className="mt-10 border-t border-line-strong pt-6">
        <h2 className="m-0 mb-4 text-[21px] font-semibold">포함된 강의</h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px]">
          {included.map((c) => (
            <li key={c.id}>
              <Link href={`/courses/${c.slug}`}>{c.title}</Link>{" "}
              <span className="text-ink-2">· {c.instructor}</span>
            </li>
          ))}
          {included.length === 0 ? <li className="text-ink-2">아직 없습니다.</li> : null}
        </ul>
        {premiumCount > 0 && discount && discount.ratePercent > 0 ? (
          <p className="m-0 mt-4 text-[14px] text-ink-2">
            프리미엄 강의 {premiumCount}개는 구독자 {discount.ratePercent}% 할인가로 살 수 있습니다.
          </p>
        ) : null}
      </section>

      <section className="mt-10 border-t border-line-strong pt-6 text-[14px] leading-[1.75] text-ink-2">
        <h2 className="m-0 mb-3 text-[21px] font-semibold text-ink">해지 · 환불</h2>
        <p className="m-0">· 해지 예약은 언제든 할 수 있고, 이미 결제한 기간 끝까지 이용합니다.</p>
        <p className="m-0">
          · 이번 회차 결제일부터 7일 이내 + 학습 전이면 전액 환불, 그 뒤 즉시 해지는 남은 날 일할 − 위약금
          10%.
        </p>
        <p className="m-0">· 가격이 오르면 30일 전에 알리고 동의를 받습니다.</p>
        <Link href="/policies/refund" className="mt-2 inline-flex min-h-11 items-center">
          환불 정책 전문 →
        </Link>
      </section>

      <section className="mt-10 border-t-2 border-line-strong pt-6">
        {live ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-[19px] font-semibold">구독 중입니다 ({live.planName})</p>
            <Link href="/my/subscription" className={buttonClass("primary", "md", "self-start")}>
              구독 관리
            </Link>
          </div>
        ) : !viewer ? (
          <div className="flex flex-wrap gap-4">
            <Link href="/signup" className={buttonClass("primary", "md")}>
              가입하고 구독하기
            </Link>
            <Link href="/login?next=%2Fsubscribe" className={buttonClass("outline", "md")}>
              로그인
            </Link>
          </div>
        ) : !billingEnabled() || plans.length === 0 ? (
          <p className="m-0 text-ink-2">구독 신청은 곧 열립니다.</p>
        ) : (
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
        )}
      </section>
    </div>
  );
}
