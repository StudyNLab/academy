import type { Metadata } from "next";
import Link from "next/link";
import { asc, schema } from "@aionit/db";
import { Notice } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import {
  monthLabel,
  PERIOD_STATE,
  Section,
  StateDot,
  Table,
  TaxNotice,
  won,
} from "@/components/settlement-view";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";
import { pendingAdjustments, settlementOverview } from "@/server/settlements";
import { AdjustmentForm, CalculateForm } from "./settlement-forms";

export const metadata: Metadata = { title: "정산 관리" };

const num = (n: number) => n.toLocaleString("ko-KR");

// AD-16 정산 관리: 월 계산 ➔ 검토 ➔ 확정(명세 공개) ➔ 지급 기록. 배분 정책 버전은 /admin/settlements/policies
export default async function AdminSettlements() {
  await requireStaff("operator", "/admin/settlements");
  const db = getDb();
  const overview = await settlementOverview(db);
  const adjustments = await pendingAdjustments(db);
  const instructors = await db
    .select({ id: schema.instructors.id, name: schema.instructors.displayName })
    .from(schema.instructors)
    .orderBy(asc(schema.instructors.displayName));

  return (
    <>
      <PageTitle label="Settlement" title="정산 관리">
        <p className="m-0">
          매월 말일 마감 ➔ 계산 ➔ 검토 ➔ 확정(강사에게 명세 공개, 이의 신청 5일) ➔ 다음 달 15일 계좌이체 ➔
          지급 기록. <Link href="/admin/settlements/policies">배분 정책 버전 →</Link>
        </p>
      </PageTitle>

      <section className="max-w-[720px]">
        <h2 className="m-0 mb-4 text-[21px] font-semibold tracking-[-0.02em]">계산</h2>
        {overview.block ? (
          <div className="mb-4">
            <Notice tone="warn">
              {overview.suggested}: {overview.block}
            </Notice>
          </div>
        ) : null}
        <CalculateForm suggested={overview.suggested} />
      </section>

      <Section title="정산 월">
        <Table
          empty="아직 계산한 달이 없습니다."
          left={2}
          head={["달", "상태", "강사", "단건", "구독", "환불 차감", "지급 예정", "지급"]}
          rows={overview.periods.map((p) => [
            <Link key="m" href={`/admin/settlements/${p.month}`}>
              {monthLabel(p.month)}
            </Link>,
            <span key="s" className="flex flex-col gap-1">
              <StateDot state={PERIOD_STATE[p.status]} />
              {p.objections > 0 ? (
                <span className="text-[13px] text-danger">이의 신청 {p.objections}건 답변 대기</span>
              ) : null}
            </span>,
            `${p.instructors}명`,
            num(p.single),
            num(p.subscription),
            num(p.refund),
            won(p.payout),
            p.status === "confirmed" ? `${p.paid}명 지급 · ${p.toPay}명 남음` : "",
          ])}
        />
      </Section>

      <Section title="조정 (다음에 계산하는 달에 들어갈 것)">
        {adjustments.length > 0 ? (
          <ul className="m-0 mb-6 list-none p-0 text-[15px]">
            {adjustments.map(({ adjustment, displayName }) => (
              <li
                key={adjustment.id}
                className="flex flex-wrap justify-between gap-3 border-b border-line py-2"
              >
                <span>
                  {displayName} · {adjustment.reason}
                </span>
                <span className="tabular-nums">{won(adjustment.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mb-6 text-ink-2">남은 조정이 없습니다.</p>
        )}
        <div className="max-w-[720px]">
          {instructors.length > 0 ? <AdjustmentForm instructors={instructors} /> : null}
          <p className="mt-3 text-[13px] text-ink-2">
            확정한 정산은 바뀌지 않으므로, 수수료 정정 · 이의 신청 반영 같은 고칠 금액은 조정으로 남겨 다음
            달에 넣습니다.
          </p>
        </div>
      </Section>
      <TaxNotice />
    </>
  );
}
