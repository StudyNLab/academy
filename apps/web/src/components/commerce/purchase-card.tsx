// P-03 구매 카드 (화면상세기획 2.3 카드의 상태). 데스크톱은 오른쪽에 따라오고, 좁은 화면은 아래 고정 막대가 함께 뜬다
import Link from "next/link";
import { buttonClass, MonoLabel } from "@aionit/ui";
import type { courseOffers } from "@/server/commerce";
import type { CourseViewAccess } from "@/server/entitlements";
import { BuyButton } from "./buy-button";
import { lastDay, periodLabel, won } from "./format";

type Offers = Awaited<ReturnType<typeof courseOffers>>;

export function PurchaseCard({
  course,
  access,
  offers,
  paymentsOn,
  loggedIn,
  previewKey,
}: {
  course: { slug: string; inSubscription: boolean };
  access: CourseViewAccess;
  offers: Offers;
  paymentsOn: boolean;
  loggedIn: boolean;
  previewKey: string | null;
}) {
  const returnTo = `/courses/${course.slug}`;
  const { purchase, extension, subscriber, subscriberPrice } = offers;
  const learner = access.kind === "learner" ? access.access : null;
  const card = "flex flex-col gap-4 bg-surface p-6 shadow-float";

  // 수강 중 (운영자 · 강사 포함)
  if (access.kind === "staff" || learner?.ok) {
    const ent = learner?.ok ? learner.entitlement : null;
    const viaSubscription = ent?.scope === "subscription_catalog";
    return (
      <div className={`${card} border-t-2 border-done`}>
        <MonoLabel className="text-xs text-done">수강 중</MonoLabel>
        <p className="m-0 text-[22px] font-semibold">
          {access.kind === "staff"
            ? "운영자 · 강사 보기"
            : viaSubscription
              ? "구독으로 수강 중"
              : "이 강의를 수강하고 있습니다"}
        </p>
        {ent?.endsAt ? <p className="m-0 text-[14px] text-ink-2">{lastDay(ent.endsAt)} 까지</p> : null}
        <Link href={`/learn/${course.slug}`} className={buttonClass("primary", "lg", "w-full")}>
          학습하기
        </Link>
        {ent?.endsAt && !viaSubscription && extension && paymentsOn ? (
          <BuyButton
            productId={extension.productId}
            label={`연장권 ${periodLabel(extension.accessDays)} · ${won(extension.quote.paidAmount)}`}
            loggedIn={loggedIn}
            returnTo={returnTo}
            variant="outline"
            size="md"
          />
        ) : null}
      </div>
    );
  }

  // 수강 기간 끝남: 연장권 · 다시 구매
  if (learner && !learner.ok && learner.reason === "expired") {
    return (
      <div className={`${card} border-t-2 border-warn`}>
        <MonoLabel className="text-xs text-ink-2">수강 기간 끝남</MonoLabel>
        <p className="m-0 text-[22px] font-semibold">수강 기간이 끝났습니다</p>
        <p className="m-0 text-[14px] leading-[1.7] text-ink-2">
          진도와 실습 체크는 남아 있습니다. 연장하면 이어서 볼 수 있습니다.
        </p>
        {paymentsOn && extension ? (
          <BuyButton
            productId={extension.productId}
            label={`연장권 ${won(extension.quote.paidAmount)} (${periodLabel(extension.accessDays)})`}
            loggedIn={loggedIn}
            returnTo={returnTo}
          />
        ) : null}
        {paymentsOn && purchase ? (
          <BuyButton
            productId={purchase.productId}
            label={`다시 구매 ${won(purchase.quote.paidAmount)}`}
            loggedIn={loggedIn}
            returnTo={returnTo}
            variant="outline"
            size="md"
          />
        ) : null}
      </div>
    );
  }

  if (!paymentsOn || !purchase) {
    return (
      <div className={`${card} border-t-2 border-line-strong`}>
        <MonoLabel className="text-xs text-ink-2">수강 안내</MonoLabel>
        <p className="m-0 text-[22px] font-semibold">
          {paymentsOn ? "지금은 판매하지 않는 강의입니다" : "곧 판매를 시작합니다"}
        </p>
        <p className="m-0 text-[14px] leading-[1.7] text-ink-2">
          {course.inSubscription ? "구독하면 이 강의를 들을 수 있습니다." : "프리미엄 강의"}
        </p>
        {course.inSubscription ? (
          <Link href="/subscribe" className={buttonClass("outline", "md", "w-full")}>
            구독 알아보기
          </Link>
        ) : null}
        {previewKey ? (
          <Link
            href={`/courses/${course.slug}/preview/${previewKey}`}
            className={buttonClass("primary", "lg", "w-full")}
          >
            무료 미리보기
          </Link>
        ) : null}
      </div>
    );
  }

  const q = purchase.quote;
  return (
    <div className={`${card} border-t-2 border-primary`}>
      <MonoLabel className="text-xs text-signal">
        {course.inSubscription ? "단건 구매" : "프리미엄 강의"}
      </MonoLabel>
      {q.discountAmount > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[15px] text-ink-2 line-through">{won(q.listPrice)}</p>
          <p className="m-0 text-[30px] font-semibold tabular-nums tracking-[-0.03em]">{won(q.paidAmount)}</p>
          <p className="m-0 text-[14px] text-done">{q.discountReason} 적용</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[30px] font-semibold tabular-nums tracking-[-0.03em]">{won(q.paidAmount)}</p>
          {subscriberPrice ? (
            <p className="m-0 text-[14px] text-ink-2">
              구독자 {won(subscriberPrice.paidAmount)} ({subscriberPrice.discountReason})
            </p>
          ) : null}
        </div>
      )}
      <p className="m-0 text-[14px] text-ink-2">수강 기간 결제일부터 {periodLabel(purchase.accessDays)}</p>
      <BuyButton
        productId={purchase.productId}
        label={subscriber && q.discountAmount > 0 ? "할인가로 구매하기" : "구매하기"}
        loggedIn={loggedIn}
        returnTo={returnTo}
      />
      <p className="m-0 text-[13px] leading-[1.6] text-ink-2">
        결제일부터 7일 이내 · 이용 전이면 전액 환불.{" "}
        <Link href="/policies/refund" className="text-link">
          환불 규정
        </Link>
      </p>
      {course.inSubscription && !subscriber ? (
        <p className="m-0 border-t border-line pt-3 text-[13px] text-ink-2">
          이 강의는 구독에도 포함됩니다. <Link href="/subscribe">구독 알아보기 →</Link>
        </p>
      ) : null}
      {/* 좁은 화면: 아래 고정 막대 */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t border-line-strong bg-surface px-5 py-3 lg:hidden">
        <span className="text-[18px] font-semibold tabular-nums">{won(q.paidAmount)}</span>
        <BuyButton
          productId={purchase.productId}
          label="구매하기"
          loggedIn={loggedIn}
          returnTo={returnTo}
          size="md"
          className=""
        />
      </div>
    </div>
  );
}
