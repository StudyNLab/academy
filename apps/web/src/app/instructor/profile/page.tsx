import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import {
  CONTRACT_STATE_LABEL,
  contractState,
  formatRate,
  formatBusinessNo,
  kstDate,
  maskTail,
} from "@aionit/core";
import { StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { instructorPage } from "@/server/instructor-page";
import { contractsOf, payoutSummary, ratesOf } from "@/server/instructors";
import { ContractAgree, PayoutForm, ProfileForm } from "../instructor-forms";
import { kstDay } from "../labels";

export const metadata: Metadata = { title: "정산 정보 · 프로필" };

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-12 max-w-[720px] scroll-mt-24 border-t border-line-strong pt-6 first:mt-0">
      <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  );
}

const STATE_TONE = { unsigned: "warn", upcoming: "muted", active: "done", ended: "muted" } as const;

// I-09 정산 정보 · 프로필: 공개 프로필, 계약(강사 이용약관 동의), 수익 비율(보기만), 지급 계좌 · 소득 구분
export default async function InstructorProfile() {
  const { db, viewer, instructor } = await instructorPage("/instructor/profile");
  const contracts = await contractsOf(db, instructor.id);
  const rates = await ratesOf(db, instructor.id);
  const payout = await payoutSummary(db, instructor.id, {
    actorId: viewer.userId,
    purpose: "강사 본인 정산 정보 확인",
    headers: await headers(),
  });
  const today = kstDate(new Date());
  const active = instructor.status === "active";

  return (
    <>
      <PageTitle label="Profile" title="정산 정보 · 프로필" />

      <Section title="계약" id="contract">
        {contracts.length === 0 ? (
          <p className="text-ink-2">
            아직 계약이 없습니다. 운영자가 계약을 만들면 여기서 확인하고 동의합니다.
          </p>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-6 p-0">
          {contracts.map(({ contract, termsTitle, termsVersion, termsBody }) => {
            const state = contractState(contract, today);
            return (
              <li key={contract.id} className="flex flex-col gap-3 border-b border-line pb-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold tabular-nums">
                    {contract.startsOn} ~ {contract.endsOn ?? "끝나는 날 없음"}
                  </span>
                  <StatusDot tone={STATE_TONE[state]}>{CONTRACT_STATE_LABEL[state]}</StatusDot>
                </div>
                {contract.memo ? <p className="m-0 text-[14px] text-ink-2">메모: {contract.memo}</p> : null}
                <p className="m-0 text-[13px] text-ink-2">
                  {termsTitle} {termsVersion}
                  {contract.signedAt ? ` · ${kstDay.format(contract.signedAt)} 동의` : ""}
                </p>
                {state === "unsigned" ? (
                  <>
                    <div className="max-h-72 overflow-y-auto border border-line bg-surface px-4 py-3 text-[14px]">
                      <SimpleMarkdown source={termsBody} />
                    </div>
                    <ContractAgree contractId={contract.id} />
                  </>
                ) : (
                  <Link href="/policies/instructor_terms" className="text-[14px]">
                    강사 이용약관 전문 보기 →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="수익 비율">
        {rates.current ? (
          <p className="m-0 text-[15px]">
            단건 매출 강사 몫{" "}
            <strong className="tabular-nums">{formatRate(rates.current.singleRateBp!)}</strong>
            {rates.currentIsDefault ? " (기본 정책)" : ` (${kstDay.format(rates.current.effectiveFrom)}부터)`}
            {rates.poolRateBp !== null
              ? ` · 구독 매출은 강사 풀 ${formatRate(rates.poolRateBp)} 을 유효 학습 시간 비율로 나눕니다`
              : ""}
          </p>
        ) : null}
        {rates.versions
          .filter((v) => v.effectiveFrom > new Date())
          .map((v) => (
            <p key={v.id} className="m-0 mt-2 text-[14px] text-ink-2">
              예정: {kstDay.format(v.effectiveFrom)}부터 {formatRate(v.singleRateBp!)}
              {v.note ? ` · ${v.note}` : ""}
            </p>
          ))}
        <p className="m-0 mt-3 text-[13px] text-ink-2">
          비율은 운영자가 계약 조건으로 정하고, 바뀌면 시행일 이후 매출부터 적용됩니다.
        </p>
      </Section>

      <Section title="지급 계좌 · 소득 구분" id="payout">
        {payout ? (
          <dl className="m-0 mb-6 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-[14px]">
            <dt className="text-ink-2">소득 구분</dt>
            <dd className="m-0">
              {payout.taxType === "individual"
                ? `개인 · 주민등록번호 ${payout.hasRrn ? "등록됨" : "없음"}`
                : `사업자 · ${formatBusinessNo(payout.businessNo!)}`}
            </dd>
            <dt className="text-ink-2">지급 계좌</dt>
            <dd className="m-0">
              {payout.bankName} {maskTail(payout.bankAccountLast4)} · {payout.accountHolder}
            </dd>
            <dt className="text-ink-2">바꾼 때</dt>
            <dd className="m-0">{kstDay.format(payout.updatedAt)}</dd>
          </dl>
        ) : (
          <p className="mt-0 mb-5 text-ink-2">아직 등록하지 않았습니다. 첫 정산 전에 등록해 주세요.</p>
        )}
        {active ? (
          <PayoutForm
            current={
              payout
                ? {
                    taxType: payout.taxType,
                    hasRrn: payout.hasRrn,
                    bankName: payout.bankName,
                    accountHolder: payout.accountHolder,
                  }
                : null
            }
          />
        ) : null}
      </Section>

      <Section title="공개 프로필">
        <p className="mt-0 mb-5 text-[14px] text-ink-2">
          강의 상세의 강사 소개와 <Link href={`/instructors/${instructor.id}`}>강사 소개 화면</Link>에
          나옵니다.
        </p>
        {active ? (
          <ProfileForm initial={{ displayName: instructor.displayName, bioMd: instructor.bioMd }} />
        ) : (
          <p className="text-ink-2">{instructor.displayName}</p>
        )}
      </Section>
    </>
  );
}
