// L-05 수강 만료 / 권한 없음 안내 (시안 #/expired .result-card) ➔ 연장권 · 구매 · 구독 안내로 잇는다
import Link from "next/link";
import { BuyButton } from "@/components/commerce/buy-button";
import { periodLabel, won } from "@/components/commerce/format";
import { SvcIcon } from "@/components/icons";
import type { Offer } from "@/server/commerce";

const day = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" });

export function AccessNotice({
  course,
  reason,
  lastEndedAt,
  previewKey,
  offers,
  returnTo,
}: {
  course: { slug: string; title: string; inSubscription: boolean };
  reason: "none" | "expired" | "not_started";
  lastEndedAt?: Date;
  previewKey?: string | null;
  /** 판매 중인 상품 (결제를 열지 않았으면 없음) */
  offers?: { purchase: Offer | null; extension: Offer | null } | null;
  returnTo: string;
}) {
  const extension = reason === "expired" ? (offers?.extension ?? null) : null;
  const purchase = reason === "not_started" ? null : (offers?.purchase ?? null);
  const title =
    reason === "expired"
      ? "수강 기간이 끝났습니다"
      : reason === "not_started"
        ? "아직 수강을 시작할 수 없습니다"
        : "이 강의의 수강권이 없습니다";
  const badge = reason === "expired" ? "PAUSED" : reason === "not_started" ? "SOON" : "LOCKED";
  return (
    <div className="wrap page-main">
      <div className="breadcrumb">
        <Link href="/">홈</Link>
        <span>/</span>
        <Link href="/learn">내 강의실</Link>
        <span>/</span>
        <span>{course.title}</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LEARNING ACCESS</span>
          <h1>{title}</h1>
          <p>
            {reason === "expired"
              ? "진도와 실습 체크, 작성한 질문은 그대로 남아 있습니다. 연장하거나 다시 수강하면 이어서 볼 수 있습니다."
              : reason === "not_started"
                ? "수강 시작일이 되면 이 화면에서 바로 볼 수 있습니다."
                : "강의를 구매하거나 구독하면 교재 전체 · 실습 파일 · 스스로 확인 · 강의 Q&A 가 열립니다."}
          </p>
        </div>
      </div>
      <section className="result-card">
        <div className="error-number">{badge}</div>
        <h2>{course.title}</h2>
        <p>
          {reason === "expired" && lastEndedAt
            ? `${day.format(new Date(lastEndedAt.getTime() - 1))}에 수강 기간이 끝났습니다.`
            : null}
          {reason === "expired" && lastEndedAt ? <br /> : null}
          {course.inSubscription ? (
            <>
              이 강의는 구독에도 포함됩니다. <Link href="/subscribe">구독 알아보기 →</Link>
            </>
          ) : (
            "프리미엄 강의입니다 (구독자 할인)."
          )}
        </p>
        <div className="result-actions">
          {extension ? (
            <BuyButton
              productId={extension.productId}
              label={`연장권 ${won(extension.quote.paidAmount)} (${periodLabel(extension.accessDays)})`}
              loggedIn
              returnTo={returnTo}
              size="md"
              className=""
            />
          ) : null}
          {purchase ? (
            <BuyButton
              productId={purchase.productId}
              label={`${reason === "expired" ? "다시 구매" : "구매하기"} ${won(purchase.quote.paidAmount)}`}
              loggedIn
              returnTo={returnTo}
              variant={extension ? "outline" : "primary"}
              size="md"
              className=""
            />
          ) : null}
          <Link
            href={`/courses/${course.slug}`}
            className={extension || purchase ? "btn secondary" : "btn primary"}
          >
            강의 안내 보기 <SvcIcon name="arrow" />
          </Link>
          {previewKey ? (
            <Link href={`/courses/${course.slug}/preview/${previewKey}`} className="btn secondary">
              무료 미리보기
            </Link>
          ) : null}
        </div>
        <Link className="small-link block" href="/learn">
          내 강의실로 돌아가기
        </Link>
      </section>
    </div>
  );
}
