import type { Metadata } from "next";
import Link from "next/link";
import { billingDateOf } from "@aionit/core";
import type { BillingInterval } from "@aionit/core";
import { desc, eq, schema } from "@aionit/db";
import { StatusDot } from "@aionit/ui";
import { formatDay, lastDay, won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "구독" };

const STATUS = {
  pending: ["카드 등록 전", "muted"],
  active: ["이용 중", "done"],
  past_due: ["결제 실패", "danger"],
  cancel_scheduled: ["해지 예약", "warn"],
  canceled: ["해지 · 환불", "muted"],
  ended: ["끝남", "muted"],
} as const;

// AD-09 구독: 상태 · 다음 결제일 · 결제 실패 (환불 처리는 AD-10). 최근 200건
export default async function AdminSubscriptions() {
  await requireStaff("operator", "/admin/subscriptions");
  const rows = await getDb()
    .select({ sub: schema.subscriptions, nickname: schema.users.nickname })
    .from(schema.subscriptions)
    .innerJoin(schema.users, eq(schema.users.id, schema.subscriptions.userId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(200);
  const live = rows.filter((r) => ["active", "past_due", "cancel_scheduled"].includes(r.sub.status));
  return (
    <>
      <PageTitle label="Subscriptions" title="구독">
        이용 중 {live.length}명 · 결제 실패 {rows.filter((r) => r.sub.status === "past_due").length}명.
        자동결제는 worker 가 매일 06:00 에 한다.
      </PageTitle>
      <ul className="surface m-0 flex list-none flex-col overflow-hidden p-0 [&>li]:px-6 text-[15px]">
        {rows.map(({ sub, nickname }) => {
          const [label, tone] = STATUS[sub.status];
          const next =
            sub.anchorDate && (sub.status === "active" || sub.status === "past_due")
              ? billingDateOf(sub.anchorDate, sub.interval as BillingInterval, sub.currentCycle + 1)
              : null;
          return (
            <li
              key={sub.id}
              className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line py-3"
            >
              <span>
                <Link href={`/admin/users/${sub.userId}`}>{nickname ?? "(탈퇴한 회원)"}</Link>
                <span className="text-ink-2">
                  {" "}
                  · {sub.planName} · {won(sub.amount)} · {sub.currentCycle}회차 · 가입{" "}
                  {formatDay(sub.createdAt)}
                  {sub.currentPeriodEnd ? ` · ${lastDay(sub.currentPeriodEnd)} 까지` : ""}
                  {next ? ` · 다음 결제 ${next}` : ""}
                  {sub.endReason ? ` · ${sub.endReason}` : ""}
                </span>
              </span>
              <StatusDot tone={tone}>{label}</StatusDot>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="py-5 text-ink-2">없음</li> : null}
      </ul>
    </>
  );
}
