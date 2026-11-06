import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/page-title";
import {
  dotDate,
  monthLabel,
  Section,
  settlementState,
  StateDot,
  Table,
  TaxNotice,
  won,
} from "@/components/settlement-view";
import { instructorPage } from "@/server/instructor-page";
import { estimateThisMonth, myStatements } from "@/server/settlements";

export const metadata: Metadata = { title: "정산" };

const num = (n: number) => n.toLocaleString("ko-KR");

// 강사 정산: 이번 달 예상 (I-01 과 같은 값) + 공개된 월별 명세 (I-08)
export default async function InstructorSettlements() {
  const { db, instructor } = await instructorPage("/instructor/settlements");
  const [estimate, statements] = await Promise.all([
    estimateThisMonth(db, instructor),
    myStatements(db, instructor),
  ]);

  return (
    <>
      <PageTitle label="Settlement" title="정산">
        <p className="m-0">
          매월 말일 마감, 다음 달 10일 명세 공개(이의 신청 5일), 15일 지급입니다. 지급 계좌 · 소득 구분은{" "}
          <Link href="/instructor/profile">정산 정보</Link>에서 바꿉니다.
        </p>
      </PageTitle>

      <section>
        <h2 className="m-0 mb-4 text-[21px] font-semibold tracking-[-0.02em]">
          {monthLabel(estimate.month)} 예상 정산액
        </h2>
        <dl className="surface m-0 grid grid-cols-2 px-6 md:grid-cols-4">
          {[
            { label: "단건 매출", value: num(estimate.single) },
            { label: "구독 배분 (지금까지)", value: num(estimate.subscription) },
            { label: "환불 차감", value: num(estimate.refund) },
            // 이의 신청 반영 등 조정 · 지난달에서 넘어온 금액도 합계에 들어가므로 있으면 보인다
            ...(estimate.adjustment + estimate.carriedIn !== 0
              ? [{ label: "조정 · 이월", value: num(estimate.adjustment + estimate.carriedIn) }]
              : []),
            { label: "강사 몫 합계 (세전)", value: won(estimate.gross) },
          ].map((tile) => (
            <div key={tile.label} className="flex min-w-0 flex-col gap-1 border-b border-line py-4 pr-4">
              <dt className="text-[13px] text-ink-2">{tile.label}</dt>
              <dd className="m-0 text-[22px] font-semibold tabular-nums tracking-[-0.03em]">{tile.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] text-ink-2">
          지금까지의 판매 · 환불 · 구독 매출 · 어제까지의 학습 시간으로 계산한 예상치입니다. 달이 끝난 뒤 계산
          · 확정한 명세({dotDate(estimate.schedule.statementOn)} 공개 예정)가 실제 금액입니다.
        </p>
      </section>

      <Section title="월별 명세">
        <Table
          empty="아직 공개된 명세가 없습니다."
          left={2}
          head={["달", "상태", "강사 몫 (세전)", "지급 예정액"]}
          rows={statements.map(({ settlement: s, month }) => [
            <Link key="m" href={`/instructor/settlements/${month}`}>
              {monthLabel(month)}
            </Link>,
            <StateDot key="s" state={settlementState(s)} />,
            num(s.grossAmount),
            won(s.payoutAmount),
          ])}
        />
      </Section>
      <TaxNotice />
    </>
  );
}
