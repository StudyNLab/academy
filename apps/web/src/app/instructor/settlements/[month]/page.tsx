import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { maskTail } from "@aionit/core";
import { PageTitle } from "@/components/page-title";
import {
  AmountTiles,
  dotDate,
  monthLabel,
  Section,
  settlementState,
  StatementLines,
  StateDot,
  TaxNotice,
  won,
} from "@/components/settlement-view";
import { instructorPage } from "@/server/instructor-page";
import { myStatement } from "@/server/settlements";
import { ObjectionForm } from "../objection-form";

export const metadata: Metadata = { title: "정산 명세" };

const time = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

// I-08 정산 명세 (화면상세기획 6장): 단건 · 구독 배분 · 환불 차감 · 이월 · 원천징수 · 지급 예정액, 근거 줄,
// 적용 정책, CSV, 이의 신청. 구매자 이름 · 이메일 · 주문 번호는 보이지 않는다
export default async function InstructorStatement({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const { db, viewer, instructor } = await instructorPage(`/instructor/settlements/${month}`);
  const data = await myStatement(db, instructor, month, { actorId: viewer.userId, headers: await headers() });
  if (!data) notFound();
  const s = data.settlement;
  const state = settlementState(s);

  return (
    <>
      <PageTitle label={`Statement · ${month}`} title={`정산 명세 · ${monthLabel(month)}`}>
        <p className="m-0">
          <Link href="/instructor/settlements">← 정산 목록</Link>
        </p>
      </PageTitle>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StateDot state={state} />
        <span className="text-[13px] text-ink-2">
          {s.publishedAt ? `명세 공개 ${time.format(s.publishedAt)}` : ""}
          {s.objectionUntil ? ` · 이의 신청 ${dotDate(s.objectionUntil)} 까지` : ""}
        </span>
      </div>
      <div className="mt-6">
        <AmountTiles s={s} />
      </div>
      <p className="mt-3 text-[15px]">
        {data.payout
          ? `${dotDate(data.payout.paidOn)} 에 ${won(data.payout.amount)} 보냈습니다`
          : s.payoutAmount > 0
            ? `지급 예정일 ${dotDate(s.payOn!)}`
            : `이번 달은 지급하지 않고 ${won(s.carryOut)}을 다음 달로 넘깁니다 (${state.label})`}
        {data.account ? ` · ${data.account.bankName} ${maskTail(data.account.last4)}` : ""}
      </p>
      {s.taxType === "business" && s.payoutAmount > 0 ? (
        <p className="mt-1 text-[13px] text-ink-2">
          세금계산서: 공급가액 {won(s.grossAmount)} · 부가세 {won(s.vatAmount)} · 합계 {won(s.payoutAmount)}{" "}
          로 발행해 주세요.
        </p>
      ) : null}

      <StatementLines lines={data.lines} />

      <Section title="적용 정책">
        <ul className="m-0 list-none p-0 text-[15px]">
          {data.policies.map((p) => (
            <li key={p.id} className="border-b border-line py-2">
              {p.name}
            </li>
          ))}
          {data.policies.length === 0 ? <li className="py-2 text-ink-2">이 달은 매출이 없습니다.</li> : null}
        </ul>
        <p className="mt-4">
          <a href={`/api/v1/instructor/settlements/${month}/csv`} download>
            CSV 받기
          </a>
        </p>
      </Section>

      <Section title="이의 신청" id="objection">
        {data.objections.length > 0 ? (
          <ul className="m-0 mb-6 flex list-none flex-col gap-5 p-0">
            {data.objections.map((o) => (
              <li
                key={o.createdAt.toISOString()}
                className="flex max-w-[720px] flex-col gap-2 border-b border-line pb-5"
              >
                <p className="m-0 text-[13px] text-ink-2">{time.format(o.createdAt)} 신청</p>
                <p className="m-0 whitespace-pre-wrap text-[15px]">{o.body}</p>
                {o.answeredAt ? (
                  <div className="border-l-2 border-brand pl-4 text-[15px]">
                    <p className="m-0 text-[13px] text-ink-2">{time.format(o.answeredAt)} 운영자 답변</p>
                    <p className="m-0 whitespace-pre-wrap">{o.answer}</p>
                    {o.adjustment !== null ? (
                      <p className="m-0 mt-1 text-[13px] text-ink-2">
                        다음 정산에 조정 {won(o.adjustment)} 반영
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="m-0 text-[13px] text-warn">답변 기다리는 중</p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {data.canObject && !data.objections.some((o) => !o.answeredAt) ? (
          <ObjectionForm month={month} until={dotDate(s.objectionUntil!)} />
        ) : !data.canObject ? (
          <p className="m-0 text-ink-2">
            이의 신청 기간(명세 공개 뒤 5일)이 지났습니다. 궁금한 점은{" "}
            <Link href="/my/inquiries">1:1 문의</Link>로 남겨 주세요.
          </p>
        ) : null}
        <p className="mt-4 text-[13px] text-ink-2">
          확정된 명세는 바뀌지 않습니다. 고칠 금액이 있으면 운영자가 다음 달 정산에 조정으로 넣습니다.
        </p>
      </Section>
      <TaxNotice />
    </>
  );
}
