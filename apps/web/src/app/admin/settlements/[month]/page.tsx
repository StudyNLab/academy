import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HOLD_LABEL } from "@aionit/core";
import { PageTitle } from "@/components/page-title";
import {
  dotDate,
  monthLabel,
  PERIOD_STATE,
  Section,
  settlementState,
  StateDot,
  Table,
  won,
} from "@/components/settlement-view";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";
import { adminPeriod } from "@/server/settlements";
import { ConfirmButton } from "../settlement-forms";

export const metadata: Metadata = { title: "월 정산" };

const num = (n: number) => n.toLocaleString("ko-KR");
const hours = (sec: number) => `${num(Math.round((sec / 3600) * 10) / 10)}시간`;
const time = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

// AD-16 한 달: 구독 풀 · 쓴 정책 · 강사별 정산, 확정 버튼
export default async function AdminSettlementMonth({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  await requireStaff("operator", `/admin/settlements/${month}`);
  const data = await adminPeriod(getDb(), month);
  if (!data) notFound();
  const { period, rows, policies } = data;
  const payout = rows.reduce((n, r) => n + r.settlement.payoutAmount, 0);

  return (
    <>
      <PageTitle label={`Settlement · ${month}`} title={`${monthLabel(month)} 정산`}>
        <p className="m-0">
          <Link href="/admin/settlements">← 정산 관리</Link> · 계산 {time.format(period.calculatedAt)}
          {period.confirmedAt ? ` · 확정 ${time.format(period.confirmedAt)}` : ""}
        </p>
      </PageTitle>
      <div className="flex flex-col gap-4">
        <StateDot state={PERIOD_STATE[period.status]} />
        {period.status === "calculated" ? (
          <ConfirmButton month={month} count={rows.length} total={won(payout)} />
        ) : null}
      </div>

      <dl className="surface m-0 mt-8 grid grid-cols-2 px-6 md:grid-cols-4">
        {[
          { label: "구독 기준액", value: won(period.subscriptionBase) },
          { label: "강사 배분 풀", value: won(period.subscriptionPool + period.poolCarryIn) },
          { label: "유효 학습 시간 (구독)", value: hours(period.subscriptionSeconds) },
          { label: "지급 예정 합계", value: won(payout) },
        ].map((tile) => (
          <div key={tile.label} className="flex min-w-0 flex-col gap-1 border-b border-line py-4 pr-4">
            <dt className="text-[13px] text-ink-2">{tile.label}</dt>
            <dd className="m-0 text-[22px] font-semibold tabular-nums tracking-[-0.03em]">{tile.value}</dd>
          </div>
        ))}
      </dl>
      {period.poolCarryIn !== 0 || period.poolCarryOut !== 0 ? (
        <p className="mt-3 text-[13px] text-ink-2">
          구독 풀: 지난달에서 넘어온 {won(period.poolCarryIn)}, 다음 달로 넘기는 {won(period.poolCarryOut)}{" "}
          (구독 환불이 그 달 매출보다 커서 마이너스인 풀은 배분하지 않고 넘깁니다).
        </p>
      ) : null}

      <Section title="강사별">
        <Table
          empty="이 달에 정산할 강사가 없습니다."
          left={2}
          head={["강사", "상태", "단건", "구독", "환불", "조정 · 이월", "세금", "지급 예정"]}
          rows={rows.map(({ settlement: s, displayName, objections, paidOn }) => [
            <Link key="n" href={`/admin/settlements/items/${s.id}`}>
              {displayName}
            </Link>,
            <span key="s" className="flex flex-col gap-1">
              <StateDot state={settlementState(s)} />
              {paidOn ? <span className="text-[13px] text-ink-2">{dotDate(paidOn)} 보냄</span> : null}
              {objections > 0 ? <span className="text-[13px] text-danger">이의 신청 답변 대기</span> : null}
              {s.status === "calculated" && s.holdReason ? (
                <span className="text-[13px] text-ink-2">{HOLD_LABEL[s.holdReason]}</span>
              ) : null}
            </span>,
            num(s.singleAmount),
            num(s.subscriptionAmount),
            num(s.refundAmount),
            num(s.adjustmentAmount + s.carriedIn),
            s.taxType === "business" && s.vatAmount > 0 ? `+${num(s.vatAmount)}` : num(-s.withheld),
            won(s.payoutAmount),
          ])}
        />
        <p className="mt-3 text-[13px] text-ink-2">
          세금: 개인은 원천징수(−), 사업자는 세금계산서 부가세(+). 지급 예정이 0원이면 다음 달로 넘깁니다
          (마이너스 · 최소 지급액 10,000원 미만 · 정산 정보 없음).
        </p>
      </Section>

      <Section title="계산에 쓴 배분 정책">
        {policies.length === 0 ? (
          <p className="m-0 text-ink-2">이 달에는 매출이 없어 쓴 정책이 없습니다.</p>
        ) : (
          <ul className="m-0 list-none p-0 text-[15px]">
            {policies.map((p) => (
              <li key={p.id} className="border-b border-line py-2">
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
