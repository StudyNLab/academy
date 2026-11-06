import type { Metadata } from "next";
import Link from "next/link";
import { instructorCourseState } from "@aionit/core";
import { StatusDot } from "@aionit/ui";
import { InstructorCourseForm } from "@/app/admin/courses/course-forms";
import { PageTitle } from "@/components/page-title";
import { FIELD_LABEL } from "@/server/catalog";
import { courseOffers } from "@/server/commerce";
import { instructorPage } from "@/server/instructor-page";
import { myCourses } from "@/server/instructors";
import { COURSE_STATE, won } from "../labels";

export const metadata: Metadata = { title: "내 강의" };

// I-02 내 강의 목록 · 등록: 상태(작성 중 / 검수 대기 / 공개 / 반려), 가격은 보기만 (운영자가 정한다)
export default async function InstructorCourses() {
  const { db, instructor } = await instructorPage("/instructor/courses");
  const courses = await myCourses(db, instructor);
  const prices = await Promise.all(
    courses.map(
      async ({ course }) => (await courseOffers(db, course, null)).purchase?.quote.listPrice ?? null,
    ),
  );

  return (
    <>
      <PageTitle label="Courses" title="내 강의">
        <p className="m-0">
          교재를 올리고 검수를 요청하면 운영자가 확인한 뒤 공개합니다. 가격 · 구독 포함 여부는 운영자가
          정합니다.
        </p>
      </PageTitle>
      <div className="surface data-table-wrap">
        <table className="data-table min-w-[640px]">
          <thead>
            <tr>
              <th className="px-2 py-2.5">과정</th>
              <th className="px-2 py-2.5">상태</th>
              <th className="px-2 py-2.5">공개 버전</th>
              <th className="px-2 py-2.5 text-right">가격</th>
              <th className="px-2 py-2.5">현황</th>
            </tr>
          </thead>
          <tbody>
            {courses.map(({ course, latest, published }, i) => {
              const state =
                COURSE_STATE[
                  instructorCourseState({
                    courseStatus: course.status,
                    latestVersionStatus: latest?.status ?? null,
                  })
                ];
              return (
                <tr key={course.id} className="border-b border-line align-top">
                  <td className="px-2 py-3">
                    <Link href={`/instructor/courses/${course.id}`}>{course.title}</Link>
                    <div className="font-mono text-[12px] text-ink-2">
                      {course.slug} · {FIELD_LABEL[course.field]} ·{" "}
                      {course.inSubscription ? "구독 포함" : "프리미엄"}
                    </div>
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    <StatusDot tone={state.tone}>{state.label}</StatusDot>
                  </td>
                  <td className="px-2 py-3 font-mono text-[13px]">
                    {published ? `v${published.version}` : "-"}
                  </td>
                  <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">
                    {prices[i] !== null ? won(prices[i]!) : <span className="text-ink-2">정하기 전</span>}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    <Link href={`/instructor/courses/${course.id}/stats`}>판매 · 수강 →</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {courses.length === 0 ? (
          <p className="py-6 text-ink-2">아직 강의가 없습니다. 아래에서 첫 과정을 만드세요.</p>
        ) : null}
      </div>
      {instructor.status === "active" ? (
        <section className="mt-8 max-w-[640px] surface padded">
          <h2 className="m-0 mb-2 text-[21px] font-semibold tracking-[-0.02em]">새 과정 만들기</h2>
          <p className="m-0 mb-5 text-[13px] text-ink-2">
            작성 중으로 만들어지고, 교재를 올려 검수를 통과해야 강의 목록에 보입니다.
          </p>
          <InstructorCourseForm />
        </section>
      ) : null}
    </>
  );
}
