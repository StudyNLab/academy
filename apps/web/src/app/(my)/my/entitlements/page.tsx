import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, schema } from "@aionit/db";
import { StatusDot } from "@aionit/ui";
import { BuyButton } from "@/components/commerce/buy-button";
import { formatDay, lastDay, periodLabel, won } from "@/components/commerce/format";
import { PageTitle } from "@/components/page-title";
import { courseOffers } from "@/server/commerce";
import { getDb } from "@/server/db";
import { paymentsEnabled } from "@/server/payments";
import { requireViewer } from "@/server/session";

export const metadata: Metadata = { title: "수강권" };

const SOURCE_LABEL: Record<string, string> = {
  purchase: "구매",
  subscription: "구독",
  admin_grant: "운영자 발급",
  free: "무료",
  extension: "연장권",
};

// M-02 수강권: 강의별 시작 · 만료일, 연장권 사기
export default async function EntitlementsPage() {
  const viewer = await requireViewer("/my/entitlements");
  const db = getDb();
  const rows = await db
    .select({ entitlement: schema.entitlements, course: schema.courses })
    .from(schema.entitlements)
    .leftJoin(schema.courses, eq(schema.courses.id, schema.entitlements.courseId))
    .where(eq(schema.entitlements.userId, viewer.userId))
    .orderBy(desc(schema.entitlements.createdAt));
  const now = new Date();
  const visible = rows.filter((r) => !r.entitlement.revokedAt);
  const offers = new Map<string, Awaited<ReturnType<typeof courseOffers>>>();
  if (paymentsEnabled())
    for (const r of visible)
      if (r.course && r.entitlement.endsAt && !offers.has(r.course.id))
        offers.set(r.course.id, await courseOffers(db, r.course, viewer, now));

  return (
    <>
      <PageTitle label="Entitlements" title="수강권" />
      <ul className="m-0 flex list-none flex-col border-t border-line-strong p-0">
        {visible.map(({ entitlement: e, course }) => {
          const active = e.startsAt <= now && (!e.endsAt || now < e.endsAt);
          const extension = course ? offers.get(course.id)?.extension : null;
          return (
            <li key={e.id} className="flex flex-col gap-2 border-b border-line py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                {course ? (
                  <Link
                    href={`/courses/${course.slug}`}
                    className="text-[17px] font-semibold text-ink no-underline"
                  >
                    {course.title}
                  </Link>
                ) : (
                  <Link href="/my/subscription" className="text-[17px] font-semibold text-ink no-underline">
                    구독 포함 강의 전체
                  </Link>
                )}
                <StatusDot tone={active ? "done" : "muted"}>{active ? "이용 중" : "끝남"}</StatusDot>
              </div>
              <p className="m-0 text-[14px] text-ink-2">
                {SOURCE_LABEL[e.sourceType]} · {formatDay(e.startsAt)} ~{" "}
                {e.endsAt ? lastDay(e.endsAt) : "무제한"}
              </p>
              {extension && e.scope === "course" && e.endsAt ? (
                <BuyButton
                  productId={extension.productId}
                  label={`연장권 ${periodLabel(extension.accessDays)} · ${won(extension.quote.paidAmount)}`}
                  loggedIn
                  returnTo="/my/entitlements"
                  variant="outline"
                  size="sm"
                  className="self-start"
                />
              ) : null}
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="py-5 text-ink-2">
            수강권이 없습니다. <Link href="/courses">강의 목록 →</Link>
          </li>
        ) : null}
      </ul>
    </>
  );
}
