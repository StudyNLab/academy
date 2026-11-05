import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { ownCoursePage } from "@/server/instructor-page";
import { courseStats } from "@/server/instructors";
import { won } from "../../../labels";

export const metadata: Metadata = { title: "판매 · 수강 현황" };

/** 막대 (값 ÷ 가장 큰 값). 숫자는 옆에 글자로 */
function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div role="img" aria-label={`${label} ${value}`} className="h-2 w-full bg-line">
      <div className="h-full bg-link" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 border-t border-line-strong pt-6">
      <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  );
}

const hours = (sec: number) => `${(sec / 3600).toFixed(1)}시간`;

// I-07 판매 · 수강 현황: 수강생 수, 진도 분포, 이탈 구간, 월별 매출. 개인 식별 정보 없음 (숫자만)
export default async function InstructorCourseStats({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, viewer, course } = await ownCoursePage(id, `/instructor/courses/${id}/stats`);
  const stats = await courseStats(db, viewer, course.id);
  const maxProgress = Math.max(0, ...stats.progress.map((b) => b.count));
  const maxStarted = Math.max(0, ...stats.chapters.map((c) => c.started));
  const maxSales = Math.max(0, ...stats.sales.map((m) => m.gross));
  const drop = stats.chapters.find((c) => c.key === stats.dropAfter);

  return (
    <>
      <PageTitle label={`Stats · ${course.slug}`} title={`${course.title} 현황`}>
        <p className="m-0">
          <Link href={`/instructor/courses/${course.id}`}>← 내 강의로</Link> · 수강생이 누구인지(이메일 ·
          닉네임 · 결제 정보)는 보이지 않고 숫자로만 보입니다. 강사 본인 · 운영자의 학습은 세지 않습니다.
        </p>
      </PageTitle>

      <dl className="m-0 grid grid-cols-2 border-t border-line-strong md:grid-cols-4">
        {[
          { label: "수강생 (공부를 시작했거나 수강권이 있는 사람)", value: stats.learners.total },
          { label: "지금 수강 중 (단건 · 발급 수강권)", value: stats.learners.active },
          { label: "구독으로 공부한 사람", value: stats.learners.viaSubscription },
          { label: "이번 달 유효 학습 시간", value: hours(stats.monthEffectiveSec) },
        ].map((tile) => (
          <div key={tile.label} className="flex flex-col gap-1 border-b border-line py-5 pr-4">
            <dt className="text-[13px] text-ink-2">{tile.label}</dt>
            <dd className="m-0 text-[28px] font-semibold tabular-nums tracking-[-0.03em]">{tile.value}</dd>
          </div>
        ))}
      </dl>

      <Section title="진도 분포">
        {stats.learners.total === 0 ? <p className="text-ink-2">아직 수강생이 없습니다.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {stats.progress.map((b) => (
            <li key={b.label} className="grid grid-cols-[84px_1fr_48px] items-center gap-3 text-[14px]">
              <span className="font-mono text-[12px] text-ink-2">{b.label}</span>
              <Bar value={b.count} max={maxProgress} label={`진도 ${b.label}`} />
              <span className="text-right tabular-nums">{b.count}명</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="챕터별 · 이탈 구간">
        {drop ? (
          <div className="mb-5">
            <Notice tone="warn" title={`${drop.label || drop.key} 다음에서 가장 많이 멈춥니다`}>
              {drop.title} 를 끝낸 뒤 다음 챕터를 열지 않은 사람이 {stats.dropCount}명입니다.
            </Notice>
          </div>
        ) : null}
        {stats.chapters.length === 0 ? <p className="text-ink-2">공개된 교재가 없습니다.</p> : null}
        <ul className="m-0 flex list-none flex-col p-0">
          {stats.chapters.map((c) => (
            <li key={c.key} className="flex flex-col gap-1.5 border-b border-line py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
                <span>
                  <span className="font-mono text-[12px] text-ink-2">{c.key}</span> {c.title}
                </span>
                <span className="tabular-nums text-ink-2">
                  연 사람 {c.started} · 끝낸 사람 {c.completed}
                </span>
              </div>
              <Bar value={c.started} max={maxStarted} label={`${c.key} 연 사람`} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="월별 매출 (최근 6개월)">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-y-2 border-line-strong text-left font-mono text-[12px]">
                <th className="px-2 py-2">월</th>
                <th className="px-2 py-2 text-right">판매</th>
                <th className="px-2 py-2 text-right">결제액</th>
                <th className="px-2 py-2 text-right">환불</th>
                <th className="px-2 py-2 text-right">매출</th>
                <th className="hidden w-[30%] px-2 py-2 sm:table-cell" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {stats.sales.map((m) => (
                <tr key={m.month} className="border-b border-line">
                  <td className="px-2 py-2.5 font-mono whitespace-nowrap">{m.month}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{m.sales}건</td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap tabular-nums">{won(m.gross)}</td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {m.refunded ? `−${won(m.refunded)}` : "-"}
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap tabular-nums font-semibold">
                    {won(m.net)}
                  </td>
                  <td className="hidden px-2 py-2.5 sm:table-cell">
                    <Bar value={m.gross} max={maxSales} label={`${m.month} 결제액`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-ink-2">
          단건 구매 · 연장권 결제액입니다 (결제한 달 기준, 환불은 끝난 달에 뺍니다). 구독 매출은 정산할 때
          유효 학습 시간 비율로 나눕니다. 강사 몫 · 지급액은 정산 명세에서 보입니다 (다음 단계).
        </p>
      </Section>
    </>
  );
}
