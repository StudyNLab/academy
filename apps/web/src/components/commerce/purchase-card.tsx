// P-03 구매 카드 (화면상세기획 2.3 카드의 상태, 모양은 시안 .purchase-card). 데스크톱은 오른쪽에 따라오고,
// 좁은 화면은 아래 고정 막대(.detail-mobile-buy, 카드 밖 — 카드의 .btn 너비 규칙을 받지 않게)가 함께 뜬다
import Link from "next/link";
import type { ReactNode } from "react";
import { SvcIcon } from "@/components/icons";
import type { courseOffers } from "@/server/commerce";
import type { CourseViewAccess } from "@/server/entitlements";
import { BuyButton } from "./buy-button";
import { lastDay, periodLabel, won } from "./format";

type Offers = Awaited<ReturnType<typeof courseOffers>>;

/** 수강하면 받는 것 (서비스 공통) */
function Includes() {
  return (
    <ul>
      <li>
        <SvcIcon name="book" /> 다시 펼쳐 보는 챕터별 교재
      </li>
      <li>
        <SvcIcon name="play" /> 개념 설명과 실습 시연 영상
      </li>
      <li>
        <SvcIcon name="code" /> 실습 파일과 스스로 확인 목록
      </li>
      <li>
        <SvcIcon name="chat" /> 챕터에 연결된 강의 Q&amp;A
      </li>
    </ul>
  );
}

function Card({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <div className="purchase-card">
      <span className="tag tag-outline">{label}</span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function PurchaseCard({
  course,
  access,
  offers,
  paymentsOn,
  loggedIn,
  previewKey,
}: {
  course: { slug: string; title: string; inSubscription: boolean };
  access: CourseViewAccess;
  offers: Offers;
  paymentsOn: boolean;
  loggedIn: boolean;
  previewKey: string | null;
}) {
  const returnTo = `/courses/${course.slug}`;
  const { purchase, extension, subscriber, subscriberPrice } = offers;
  const learner = access.kind === "learner" ? access.access : null;
  const previewLink = previewKey ? (
    <Link className="btn secondary" href={`/courses/${course.slug}/preview/${previewKey}`}>
      교재 무료 미리보기 <SvcIcon name="book" />
    </Link>
  ) : null;

  // 수강 중 (운영자 · 강사 포함)
  if (access.kind === "staff" || learner?.ok) {
    const ent = learner?.ok ? learner.entitlement : null;
    const viaSubscription = ent?.scope === "subscription_catalog";
    return (
      <Card label="수강 중" title={course.title}>
        <p className="purchase-caption">
          {access.kind === "staff"
            ? "운영자 · 강사 보기"
            : viaSubscription
              ? "구독으로 수강 중"
              : "이 강의를 수강하고 있습니다"}
          {ent?.endsAt ? ` · ${lastDay(ent.endsAt)} 까지` : ""}
        </p>
        <Link href={`/learn/${course.slug}`} className="btn primary">
          학습하기 <SvcIcon name="arrow" />
        </Link>
        {ent?.endsAt && !viaSubscription && extension && paymentsOn ? (
          <BuyButton
            productId={extension.productId}
            label={`연장권 ${periodLabel(extension.accessDays)} · ${won(extension.quote.paidAmount)}`}
            loggedIn={loggedIn}
            returnTo={returnTo}
            variant="outline"
            className=""
          />
        ) : null}
        <Includes />
      </Card>
    );
  }

  // 수강 기간 끝남: 연장권 · 다시 구매
  if (learner && !learner.ok && learner.reason === "expired") {
    return (
      <Card label="수강 기간 끝남" title={course.title}>
        <p className="purchase-caption">진도와 실습 체크는 남아 있습니다. 연장하면 이어서 볼 수 있습니다.</p>
        {paymentsOn && extension ? (
          <BuyButton
            productId={extension.productId}
            label={`연장권 ${won(extension.quote.paidAmount)} (${periodLabel(extension.accessDays)})`}
            loggedIn={loggedIn}
            returnTo={returnTo}
            className=""
          />
        ) : null}
        {paymentsOn && purchase ? (
          <BuyButton
            productId={purchase.productId}
            label={`다시 구매 ${won(purchase.quote.paidAmount)}`}
            loggedIn={loggedIn}
            returnTo={returnTo}
            variant="outline"
            className=""
          />
        ) : null}
      </Card>
    );
  }

  if (!paymentsOn || !purchase) {
    return (
      <Card label="수강 안내" title={course.title}>
        <p className="purchase-caption">
          {paymentsOn ? "지금은 판매하지 않는 강의입니다." : "곧 판매를 시작합니다."}{" "}
          {course.inSubscription ? "구독하면 이 강의를 들을 수 있습니다." : "프리미엄 강의"}
        </p>
        {course.inSubscription ? (
          <Link href="/subscribe" className="btn primary">
            구독 알아보기 <SvcIcon name="arrow" />
          </Link>
        ) : null}
        {previewLink}
        <Includes />
      </Card>
    );
  }

  const q = purchase.quote;
  return (
    <>
      <Card label={course.inSubscription ? "단건 구매 / 구독" : "프리미엄 강의"} title={course.title}>
        {q.discountAmount > 0 ? <p className="purchase-caption line-through">{won(q.listPrice)}</p> : null}
        <div className="purchase-price">{won(q.paidAmount)}</div>
        <p className="purchase-caption">
          부가세 포함 · 수강 기간 결제일부터 {periodLabel(purchase.accessDays)}
          {q.discountAmount > 0 ? ` · ${q.discountReason} 적용` : ""}
          {subscriberPrice
            ? ` · 구독자 ${won(subscriberPrice.paidAmount)} (${subscriberPrice.discountReason})`
            : ""}
        </p>
        <BuyButton
          productId={purchase.productId}
          label={subscriber && q.discountAmount > 0 ? "할인가로 구매하기" : "구매하기"}
          loggedIn={loggedIn}
          returnTo={returnTo}
          className=""
        />
        {previewLink}
        <Includes />
        <p className="purchase-note">
          결제일부터 7일 이내 · 이용 전이면 전액 환불. 이후에는 진도와 지난 기간에 따라 환불합니다.
          <br />
          <Link className="link-line" href="/policies/refund">
            환불 규정
          </Link>
        </p>
        {course.inSubscription && !subscriber ? (
          <p className="purchase-note">
            이 강의는 구독에도 포함됩니다. <Link href="/subscribe">구독 알아보기 →</Link>
          </p>
        ) : null}
      </Card>
      {/* 좁은 화면: 아래 고정 막대 */}
      <div className="detail-mobile-buy">
        <div>
          <small>{course.title}</small>
          <strong>{won(q.paidAmount)}</strong>
        </div>
        <BuyButton
          productId={purchase.productId}
          label="구매하기"
          loggedIn={loggedIn}
          returnTo={returnTo}
          className=""
        />
      </div>
    </>
  );
}
