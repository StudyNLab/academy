import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBusinessNo, kstDate, maskTail } from "@aionit/core";
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
import { getDb } from "@/server/db";
import { isUuid } from "@/server/instructor-page";
import { requireStaff } from "@/server/session";
import { adminSettlement } from "@/server/settlements";
import { AccountReveal, AnswerForm, PayoutForm } from "../../settlement-forms";

export const metadata: Metadata = { title: "강사 정산" };

const time = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "medium",
  timeStyle: "short",
});

// AD-16 강사 한 명의 한 달: 근거 줄 · 이의 신청 답변 · 계좌 · 지급 기록
export default async function AdminSettlementItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireStaff("operator", `/admin/settlements/items/${id}`);
  if (!isUuid(id)) notFound();
  const data = await adminSettlement(getDb(), id, { actorId: viewer.userId, headers: await headers() });
  if (!data) notFound();
  const { settlement: s, period, instructor, account } = data;
  const state = settlementState(s);

  return (
    <>
      <PageTitle
        label={`Settlement · ${period.month}`}
        title={`${instructor.displayName} · ${monthLabel(period.month)}`}
      >
        <p className="m-0">
          <Link href={`/admin/settlements/${period.month}`}>← {monthLabel(period.month)} 정산</Link> ·{" "}
          <Link href={`/admin/instructors/${instructor.id}`}>강사 정보</Link>
        </p>
      </PageTitle>
      <StateDot state={state} />
      <div className="mt-6">
        <AmountTiles s={s} />
      </div>
      <p className="mt-3 text-[13px] text-ink-2">
        {s.publishedAt
          ? `명세 공개 ${time.format(s.publishedAt)} · 이의 신청 ${dotDate(s.objectionUntil!)} 까지 · `
          : ""}
        {s.payOn ? `지급 예정일 ${dotDate(s.payOn)}` : "확정하면 명세가 공개됩니다"}
        {s.carryOut !== 0 ? ` · 다음 달로 넘김 ${won(s.carryOut)}` : ""}
      </p>

      <Section title="지급">
        {account ? (
          <p className="m-0 mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px]">
            <span>
              {account.taxType === "individual"
                ? "개인 (원천징수)"
                : `사업자 ${formatBusinessNo(account.businessNo!)}`}{" "}
              · {account.bankName} {maskTail(account.bankAccountLast4)} · 예금주 {account.accountHolder}
            </span>
            {s.status !== "calculated" && s.payoutAmount > 0 ? <AccountReveal settlementId={s.id} /> : null}
          </p>
        ) : (
          <p className="m-0 mb-4 text-danger">
            강사가 정산 정보(I-09)를 아직 넣지 않았습니다. 지급하지 않고 다음 달로 넘깁니다.
          </p>
        )}
        {data.payout ? (
          <p className="m-0 text-[15px]">
            {dotDate(data.payout.paidOn)} 에 {won(data.payout.amount)} 보냄 (계좌이체)
            {data.payout.memo ? ` · ${data.payout.memo}` : ""} · 기록 {time.format(data.payout.createdAt)}
          </p>
        ) : s.status === "confirmed" && s.payoutAmount > 0 ? (
          <div className="max-w-[720px]">
            <PayoutForm settlementId={s.id} today={kstDate(new Date())} amount={won(s.payoutAmount)} />
          </div>
        ) : s.status === "calculated" ? (
          <p className="m-0 text-ink-2">확정한 뒤에 지급 기록을 남길 수 있습니다.</p>
        ) : (
          <p className="m-0 text-ink-2">지급할 금액이 없습니다 ({state.label}).</p>
        )}
      </Section>

      <Section title="이의 신청">
        {data.objections.length === 0 ? (
          <p className="m-0 text-ink-2">이의 신청이 없습니다.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-6 p-0">
            {data.objections.map(({ objection, adjustment }) => (
              <li key={objection.id} className="flex max-w-[720px] flex-col gap-3 border-b border-line pb-6">
                <p className="m-0 text-[13px] text-ink-2">{time.format(objection.createdAt)} 강사 신청</p>
                <p className="m-0 whitespace-pre-wrap text-[15px]">{objection.body}</p>
                {objection.answeredAt ? (
                  <div className="border-l-2 border-line-strong pl-4 text-[15px]">
                    <p className="m-0 text-[13px] text-ink-2">{time.format(objection.answeredAt)} 답변</p>
                    <p className="m-0 whitespace-pre-wrap">{objection.answer}</p>
                    {adjustment ? (
                      <p className="m-0 mt-1 text-[13px] text-ink-2">다음 달 조정 {won(adjustment.amount)}</p>
                    ) : null}
                  </div>
                ) : (
                  <AnswerForm objectionId={objection.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <StatementLines lines={data.lines} />

      <Section title="계산에 쓴 배분 정책">
        <ul className="m-0 list-none p-0 text-[15px]">
          {data.policies.map((p) => (
            <li key={p.id} className="border-b border-line py-2">
              {p.name}
            </li>
          ))}
        </ul>
      </Section>
      <TaxNotice />
    </>
  );
}
