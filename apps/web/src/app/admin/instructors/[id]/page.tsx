import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CONTRACT_STATE_LABEL,
  contractState,
  formatBusinessNo,
  formatRate,
  kstDate,
  maskTail,
} from "@aionit/core";
import { StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { maskEmail } from "@/server/admin-queries";
import { getDb } from "@/server/db";
import { adminInstructor, INSTRUCTOR_STATUS, payoutSummary, ratesOf } from "@/server/instructors";
import { requireStaff } from "@/server/session";
import {
  ContractForm,
  ContractRemove,
  LinkMemberForm,
  RateForm,
  StatusForm,
} from "../instructor-admin-forms";

export const metadata: Metadata = { title: "강사 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 max-w-[720px] border-t border-line-strong pt-6">
      <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  );
}

// AD-15 강사 상세: 회원 잇기 · 상태 · 계약(강사 이용약관 동의 기록) · 수익 비율 버전 · 정산 정보(끝 4자리, 조회 기록)
export default async function AdminInstructorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireStaff("operator", `/admin/instructors/${id}`);
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const data = await adminInstructor(db, id);
  if (!data) notFound();
  const { instructor } = data;
  const rates = await ratesOf(db, id);
  const payout = await payoutSummary(db, id, {
    actorId: viewer.userId,
    purpose: "강사 관리 (AD-15)",
    headers: await headers(),
  });
  const now = new Date();
  const today = kstDate(now);
  const tomorrow = kstDate(new Date(now.getTime() + 86_400_000));
  const status = INSTRUCTOR_STATUS[instructor.status];

  return (
    <>
      <PageTitle label="Instructor" title={instructor.displayName}>
        <p className="m-0">
          <Link href="/admin/instructors">← 강사 목록</Link> ·{" "}
          {data.nickname ? (
            <>
              회원 <Link href={`/admin/users/${instructor.userId}`}>{data.nickname}</Link> (
              {maskEmail(data.email!)})
            </>
          ) : (
            "회원과 잇기 전"
          )}
        </p>
      </PageTitle>
      <StatusDot tone={status.tone}>{status.label}</StatusDot>

      <Section title="과정">
        {data.courses.length === 0 ? <p className="m-0 text-ink-2">맡은 과정이 없습니다.</p> : null}
        <ul className="m-0 list-none p-0 text-[15px]">
          {data.courses.map((c) => (
            <li key={c.id} className="border-b border-line py-2">
              <Link href={`/admin/courses/${c.id}`}>{c.title}</Link>{" "}
              <span className="text-[13px] text-ink-2">
                {c.status === "published" ? "공개" : c.status === "hidden" ? "숨김" : "작성 중"}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {!instructor.userId ? (
        <Section title="회원 잇기">
          <LinkMemberForm instructorId={instructor.id} />
        </Section>
      ) : null}

      <Section title="계약">
        <ul className="m-0 mb-6 flex list-none flex-col p-0">
          {data.contracts.map(({ contract, termsTitle, termsVersion }) => {
            const state = contractState(contract, today);
            return (
              <li
                key={contract.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="tabular-nums">
                    {contract.startsOn} ~ {contract.endsOn ?? "끝나는 날 없음"}
                  </span>
                  <span className="text-[13px] text-ink-2">
                    {termsTitle} {termsVersion}
                    {contract.signedAt ? ` · ${day.format(contract.signedAt)} 강사 동의` : ""}
                    {contract.memo ? ` · ${contract.memo}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-4">
                  <StatusDot tone={state === "active" ? "done" : state === "unsigned" ? "warn" : "muted"}>
                    {CONTRACT_STATE_LABEL[state]}
                  </StatusDot>
                  {!contract.signedAt ? <ContractRemove contractId={contract.id} /> : null}
                </span>
              </li>
            );
          })}
          {data.contracts.length === 0 ? <li className="py-2 text-ink-2">계약이 없습니다.</li> : null}
        </ul>
        <ContractForm instructorId={instructor.id} />
      </Section>

      <Section title="수익 비율">
        <p className="mt-0 text-[15px]">
          지금 단건 매출 강사 몫{" "}
          <strong className="tabular-nums">
            {rates.current ? formatRate(rates.current.singleRateBp!) : "-"}
          </strong>
          {rates.currentIsDefault ? " (기본 정책)" : ""}
          {rates.poolRateBp !== null ? ` · 구독 강사 풀 ${formatRate(rates.poolRateBp)} (기본 정책)` : ""}
        </p>
        {rates.versions.length > 0 ? (
          <ul className="m-0 mb-6 list-none p-0 text-[14px]">
            {rates.versions.map((v) => (
              <li key={v.id} className="border-b border-line py-2 tabular-nums">
                {day.format(v.effectiveFrom)}부터 {formatRate(v.singleRateBp!)}
                {v.effectiveFrom > now ? " (예정)" : ""}
                {v.note ? <span className="text-ink-2"> · {v.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <RateForm instructorId={instructor.id} tomorrow={tomorrow} />
      </Section>

      <Section title="정산 정보">
        {payout ? (
          <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-[14px]">
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
            <dd className="m-0">{day.format(payout.updatedAt)}</dd>
          </dl>
        ) : (
          <p className="m-0 text-ink-2">강사가 아직 등록하지 않았습니다 (강사 화면 → 정산 정보 · 프로필).</p>
        )}
        <p className="mt-3 text-[13px] text-ink-2">
          이 화면을 열면 개인정보 조회 기록이 남습니다. 번호 전체는 지급할 때만 꺼냅니다 (정산 단계).
        </p>
      </Section>

      <Section title="상태">
        <StatusForm instructorId={instructor.id} current={instructor.status} />
      </Section>
    </>
  );
}
