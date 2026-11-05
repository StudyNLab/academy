import type { Metadata } from "next";
import Link from "next/link";
import { INSTRUCTOR_VERSION_STATUS, instructorCourseState } from "@aionit/core";
import { Notice, StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { instructorPage } from "@/server/instructor-page";
import { contractsOf, instructorDashboard } from "@/server/instructors";
import { estimateThisMonth } from "@/server/settlements";
import { COURSE_STATE, won } from "./labels";

export const metadata: Metadata = { title: "강사 화면" };

// I-01 강사 대시보드: 미답변 질문, 이번 달 수강생 · 판매 · 예상 정산액, 검수 상태
export default async function InstructorHome() {
  const { db, instructor } = await instructorPage("/instructor");
  const [data, estimate] = await Promise.all([
    instructorDashboard(db, instructor),
    estimateThisMonth(db, instructor),
  ]);
  const unsigned = (await contractsOf(db, instructor.id)).filter((c) => !c.contract.signedAt);
  const [year, month] = data.month.split("-");
  const tiles = [
    { label: "미답변 질문", value: data.unanswered, href: "/instructor/qna" },
    { label: `${Number(month)}월 새 수강생`, value: data.newLearners },
    { label: `${Number(month)}월 판매`, value: `${data.sales}건` },
    { label: `${Number(month)}월 매출 (환불 뺌)`, value: won(data.net) },
    {
      label: `${Number(month)}월 예상 정산액 (세전)`,
      value: won(estimate.gross),
      href: "/instructor/settlements",
    },
  ];

  return (
    <>
      <PageTitle label="Instructor" title={`${instructor.displayName} 강사님`}>
        <p className="m-0">
          {year}년 {Number(month)}월 현황입니다. 수강생 개인정보(이메일 · 결제 정보)는 보이지 않고 숫자로만
          보입니다.
        </p>
      </PageTitle>
      <div className="flex flex-col gap-3">
        {instructor.status !== "active" ? (
          <Notice
            tone="warn"
            title={instructor.status === "suspended" ? "강사 활동이 정지되었습니다" : "계약이 끝났습니다"}
          >
            교재 · 영상 · 강의 정보를 고칠 수 없고, 현황 · Q&A 는 볼 수 있습니다. 궁금한 점은 1:1 문의로 남겨
            주세요.
          </Notice>
        ) : null}
        {unsigned.length > 0 ? (
          <Notice tone="info" title="동의할 강사 계약이 있습니다">
            <Link href="/instructor/profile#contract">
              계약 기간과 강사 이용약관을 확인하고 동의해 주세요 →
            </Link>
          </Notice>
        ) : null}
      </div>

      <dl className="m-0 mt-6 grid grid-cols-2 border-t border-line-strong md:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col gap-1 border-b border-line py-5 pr-4">
            <dt className="text-[13px] text-ink-2">{tile.label}</dt>
            <dd className="m-0 text-[28px] font-semibold tabular-nums tracking-[-0.03em] md:text-[32px]">
              {tile.href ? (
                <Link href={tile.href} className="text-ink no-underline">
                  {tile.value}
                </Link>
              ) : (
                tile.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[13px] text-ink-2">
        매출은 결제액 합계에서 이번 달 끝난 환불을 뺀 값입니다. 예상 정산액은 지금까지의 판매 · 구독 배분으로
        계산한 강사 몫(원천징수 전)이고, 실제 금액은 다음 달 10일 공개되는{" "}
        <Link href="/instructor/settlements">정산 명세</Link>입니다.
      </p>

      <section className="mt-12 border-t border-line-strong pt-6">
        <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">검수 상태</h2>
        {data.courses.length === 0 ? (
          <p className="text-ink-2">
            아직 강의가 없습니다. <Link href="/instructor/courses">내 강의</Link>에서 첫 과정을 만드세요.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {data.courses.map(({ course, latest }) => {
              const state =
                COURSE_STATE[
                  instructorCourseState({
                    courseStatus: course.status,
                    latestVersionStatus: latest?.status ?? null,
                  })
                ];
              return (
                <li
                  key={course.id}
                  className="flex flex-col gap-1 border-b border-line py-3 sm:flex-row sm:items-baseline sm:justify-between"
                >
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <Link href={`/instructor/courses/${course.id}`} className="text-[15px]">
                      {course.title}
                    </Link>
                    <StatusDot tone={state.tone}>{state.label}</StatusDot>
                  </span>
                  <span className="text-[13px] text-ink-2">
                    {latest ? (
                      <>
                        최근 버전 <span className="font-mono">v{latest.version}</span> ·{" "}
                        {INSTRUCTOR_VERSION_STATUS[latest.status].label}
                        {latest.status === "rejected" && latest.reviewNote ? (
                          <span className="block text-danger sm:inline"> · 사유: {latest.reviewNote}</span>
                        ) : null}
                      </>
                    ) : (
                      "교재를 올리기 전"
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
