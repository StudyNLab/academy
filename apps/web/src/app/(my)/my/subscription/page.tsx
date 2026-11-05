import type { Metadata } from "next";
import Link from "next/link";
import { eq, schema } from "@aionit/db";
import { subscriptionView } from "@aionit/payments";
import { buttonClass, Notice, StatusDot } from "@aionit/ui";
import { formatDay, lastDay, won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { requireViewer } from "@/server/session";
import {
  AgreePriceButton,
  CancelSubscription,
  ChangeCardButton,
  UndoCancelButton,
} from "./subscription-actions";

export const metadata: Metadata = { title: "구독 관리" };

const longDay = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" });
const kstDay = (day: string) => longDay.format(new Date(`${day}T12:00:00+09:00`));

const STATUS = {
  pending: ["카드 등록 전", "muted"],
  active: ["이용 중", "done"],
  past_due: ["결제 실패", "danger"],
  cancel_scheduled: ["해지 예약됨", "warn"],
  canceled: ["해지됨", "muted"],
  ended: ["끝남", "muted"],
} as const;

// M-03 구독 관리 (화면상세기획 4장): 해지는 가입만큼 쉽게 (클릭 2번). 설문 강요 · 할인 제안 · 상담 연결 없음
export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  const viewer = await requireViewer("/my/subscription");
  const db = getDb();
  const { sub, last, cycles, nextBilling, nextAmount } = await subscriptionView(db, viewer.userId);
  const params = await searchParams;

  if (!sub || sub.status === "pending") {
    return (
      <>
        <PageTitle label="Subscription" title="구독 관리" />
        <div className="surface padded flex flex-col gap-4">
          <p className="m-0 text-[17px]">
            {sub
              ? "카드 등록을 마치지 않은 신청이 있습니다. 다시 신청해 주세요."
              : last
                ? `구독이 끝났습니다${last.endedAt ? ` (${formatDay(last.endedAt)})` : ""}. 진도 기록은 남아 있습니다.`
                : "구독하고 있지 않습니다."}
          </p>
          <Link href="/subscribe" className={buttonClass("primary", "md", "self-start")}>
            {last ? "다시 구독하기" : "구독 알아보기"}
          </Link>
        </div>
      </>
    );
  }

  const [label, tone] = STATUS[sub.status];
  const currentCycle = cycles.find((c) => c.cycleNo === sub.currentCycle && c.status === "paid");
  const [currentItem] = currentCycle?.orderId
    ? await db
        .select({ id: schema.orderItems.id })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, currentCycle.orderId))
    : [];
  const failedCycle = cycles.find((c) => c.cycleNo === sub.currentCycle + 1 && c.status === "failed");
  const periodEnd = sub.currentPeriodEnd;

  return (
    <>
      <PageTitle label="Subscription" title="구독 관리" />
      {params.card === "fail" ? <Notice tone="warn">카드를 바꾸지 않았습니다.</Notice> : null}
      {sub.status === "past_due" && failedCycle ? (
        <Notice tone="danger" title="자동결제에 실패했습니다. 결제 수단을 바꿔 주세요.">
          {failedCycle.nextRetryAt ? `${formatDay(failedCycle.nextRetryAt)} 에 다시 시도합니다. ` : ""}
          그동안 지금처럼 이용할 수 있습니다. ({failedCycle.lastError})
        </Notice>
      ) : null}
      {sub.pendingAmount !== null && sub.pendingFromCycle !== null && sub.anchorDate ? (
        <Notice tone="info" title={`가격이 ${won(sub.pendingAmount)} 으로 바뀝니다`}>
          {sub.pendingNeedsConsent
            ? sub.pendingAgreedAt
              ? "새 가격에 동의하셨습니다."
              : "동의해야 새 가격으로 이어집니다. 동의하지 않으면 지금 기간 끝에 구독이 끝납니다."
            : "다음 결제부터 적용됩니다."}
          {sub.pendingNeedsConsent && !sub.pendingAgreedAt ? (
            <AgreePriceButton subscriptionId={sub.id} />
          ) : null}
        </Notice>
      ) : null}

      <dl className="surface padded m-0 mt-4 grid grid-cols-[110px_1fr] gap-y-3 text-[15px]">
        <dt className="text-ink-2">요금제</dt>
        <dd className="m-0">
          {sub.planName} <StatusDot tone={tone}>{label}</StatusDot>
        </dd>
        <dt className="text-ink-2">이용 기간</dt>
        <dd className="m-0">{periodEnd ? `${lastDay(periodEnd)} 까지` : "-"}</dd>
        {sub.status === "active" || sub.status === "past_due" ? (
          <>
            <dt className="text-ink-2">다음 결제</dt>
            <dd className="m-0">
              {nextBilling ? kstDay(nextBilling) : "-"} · {won(nextAmount ?? sub.amount)}
            </dd>
          </>
        ) : null}
        <dt className="text-ink-2">결제 수단</dt>
        <dd className="m-0 flex flex-wrap items-center gap-x-4">
          {sub.cardLabel ?? "-"}
          {sub.status !== "canceled" ? <ChangeCardButton subscriptionId={sub.id} /> : null}
        </dd>
      </dl>

      <div className="surface padded mt-5 flex flex-col gap-4">
        {sub.status === "cancel_scheduled" ? (
          <>
            <p className="m-0 text-[16px]">
              {periodEnd ? `${lastDay(periodEnd)} 까지 이용 후 끝납니다.` : "기간 끝에 끝납니다."}
              {sub.cancelReason === "가격 변경 미동의" ? " (가격 변경에 동의하지 않음)" : ""}
            </p>
            {sub.cancelReason !== "가격 변경 미동의" ? <UndoCancelButton subscriptionId={sub.id} /> : null}
          </>
        ) : (
          <CancelSubscription subscriptionId={sub.id} periodEnd={periodEnd ? lastDay(periodEnd) : null} />
        )}
        {currentItem ? (
          <Link href={`/my/payments/${currentItem.id}/refund`} className="self-start text-[14px] text-ink-2">
            결제가 이미 된 기간을 바로 끝내고 환불받으려면 ▸
          </Link>
        ) : null}
      </div>

      <h2 className="mt-10 mb-3 text-[19px] font-semibold">결제 회차</h2>
      <ul className="m-0 flex list-none flex-col p-0 text-[14px]">
        {cycles.map((c) => (
          <li key={c.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-2.5">
            <span>
              {c.cycleNo}회차 · {kstDay(c.billingDate)}
            </span>
            <span className="tabular-nums">
              {won(c.amount)} ·{" "}
              {c.status === "paid"
                ? "결제 완료"
                : c.status === "refunded"
                  ? "환불"
                  : c.status === "failed"
                    ? "실패"
                    : "예정"}
            </span>
          </li>
        ))}
      </ul>
      <Link href="/my/payments" className="mt-4 inline-flex min-h-11 items-center">
        결제 내역 · 영수증 →
      </Link>
    </>
  );
}
