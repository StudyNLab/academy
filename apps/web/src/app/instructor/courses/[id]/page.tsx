import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { instructorCourseState } from "@aionit/core";
import { Notice, StatusDot } from "@aionit/ui";
import { InstructorCourseForm } from "@/app/admin/courses/course-forms";
import { CourseManage, ManageSection } from "@/components/course-manage";
import { PageTitle } from "@/components/page-title";
import { adminCourse, FIELD_LABEL } from "@/server/catalog";
import { courseOffers } from "@/server/commerce";
import { ownCoursePage } from "@/server/instructor-page";
import { COURSE_STATE, won } from "../../labels";

export const metadata: Metadata = { title: "내 강의 관리" };

// I-02 과정 정보 · I-03 교재 패키지 업로드 · I-04 영상 연결(유튜브 · 자체 서버 영상 · 자막) · I-05 미리보기 범위 · 첨부.
// 자기 과정만 (남의 과정은 404). 공개 · 가격 · 구독 포함은 운영자가 정한다
export default async function InstructorCourse({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, instructor, course } = await ownCoursePage(id, `/instructor/courses/${id}`);
  const data = await adminCourse(db, course.id);
  if (!data) notFound();
  const latest = data.versions[0] ?? null;
  const state =
    COURSE_STATE[
      instructorCourseState({ courseStatus: course.status, latestVersionStatus: latest?.status ?? null })
    ];
  const price = (await courseOffers(db, course, null)).purchase?.quote.listPrice ?? null;
  const active = instructor.status === "active";

  return (
    <>
      <PageTitle label={`Course · ${course.slug}`} title={course.title}>
        <p className="m-0">
          {FIELD_LABEL[course.field]} · {course.level || "수준 미정"} ·{" "}
          {course.inSubscription ? "구독 포함" : "프리미엄"} · 가격{" "}
          {price !== null ? won(price) : "정하기 전"} (운영자가 정합니다)
        </p>
      </PageTitle>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <StatusDot tone={state.tone}>{state.label}</StatusDot>
        {course.status !== "draft" ? <Link href={`/courses/${course.slug}`}>강의 상세 보기 →</Link> : null}
        {course.publishedVersionId ? (
          <Link href={`/learn/${course.slug}`}>수강생 화면으로 보기 →</Link>
        ) : null}
        <Link href={`/instructor/courses/${course.id}/stats`}>판매 · 수강 현황 →</Link>
      </div>
      {latest?.status === "rejected" && latest.reviewNote ? (
        <div className="mt-6">
          <Notice tone="danger" title={`v${latest.version} 검수가 반려되었습니다`}>
            사유: {latest.reviewNote}{" "}
            <Link href={`/instructor/courses/${course.id}/versions/${latest.id}`}>
              고친 뒤 다시 요청하기 →
            </Link>
          </Notice>
        </div>
      ) : null}
      {latest?.status === "ready" ? (
        <div className="mt-6">
          <Notice tone="info" title={`v${latest.version} 검사를 통과했습니다`}>
            <Link href={`/instructor/courses/${course.id}/versions/${latest.id}`}>
              미리보기를 확인하고 검수를 요청해 주세요 →
            </Link>
          </Notice>
        </div>
      ) : null}

      {active ? (
        <CourseManage db={db} data={data} base="/instructor" />
      ) : (
        <div className="mt-8">
          <Notice tone="warn" title="지금은 고칠 수 없습니다">
            강사 활동이 정지되었거나 계약이 끝나 교재 · 영상을 고칠 수 없습니다. 현황은 계속 볼 수 있습니다.
          </Notice>
        </div>
      )}

      {active ? (
        <ManageSection title="과정 정보" id="info">
          <div className="max-w-[640px]">
            <InstructorCourseForm
              courseId={course.id}
              initial={{
                title: course.title,
                field: course.field,
                level: course.level,
                summary: course.summary,
                descriptionMd: course.descriptionMd,
                audienceMd: course.audienceMd,
                requirementsMd: course.requirementsMd,
              }}
            />
          </div>
        </ManageSection>
      ) : null}
    </>
  );
}
