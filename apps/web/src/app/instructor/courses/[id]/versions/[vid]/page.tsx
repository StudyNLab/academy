import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canRequestReview, INSTRUCTOR_VERSION_STATUS } from "@aionit/core";
import { Notice, StatusDot } from "@aionit/ui";
import { AutoRefresh } from "@/app/admin/courses/[id]/course-admin-forms";
import { kstTime } from "@/components/course-manage";
import { PageTitle } from "@/components/page-title";
import { VersionReport } from "@/components/version-report";
import { adminVersion } from "@/server/catalog";
import { isUuid, ownCoursePage } from "@/server/instructor-page";
import { ReviewRequestForm } from "../../../../instructor-forms";

export const metadata: Metadata = { title: "교재 버전" };

// I-03 검사 결과 · I-05 미리보기 · 검수 요청. 반려되면 사유가 여기와 메일로 온다
export default async function InstructorVersion({
  params,
}: {
  params: Promise<{ id: string; vid: string }>;
}) {
  const { id, vid } = await params;
  const { db, instructor, course } = await ownCoursePage(id, `/instructor/courses/${id}/versions/${vid}`);
  if (!isUuid(vid)) notFound();
  const data = await adminVersion(db, vid);
  if (!data || data.course.id !== course.id) notFound();
  const { version } = data;
  const status = INSTRUCTOR_VERSION_STATUS[version.status];
  const report = version.validationReport as { ok?: boolean } | null;
  const processing = version.status === "uploaded" || version.status === "processing";
  const requestable =
    instructor.status === "active" &&
    canRequestReview({ status: version.status, validationOk: !!report?.ok });

  return (
    <>
      <PageTitle label={`Version · ${course.slug}`} title={`${course.title} v${version.version}`}>
        <p className="m-0">
          <Link href={`/instructor/courses/${course.id}`}>← 내 강의로</Link>
        </p>
      </PageTitle>
      <StatusDot tone={status.tone}>{status.label}</StatusDot>
      {processing ? <AutoRefresh /> : null}
      <div className="mt-4 flex flex-col gap-3">
        {version.status === "rejected" && version.reviewNote ? (
          <Notice
            tone="danger"
            title={`반려 · ${version.reviewedAt ? kstTime.format(version.reviewedAt) : ""}`}
          >
            사유: {version.reviewNote}
          </Notice>
        ) : null}
        {version.status === "in_review" ? (
          <Notice tone="info" title="운영자가 검수하고 있습니다">
            {version.reviewRequestedAt ? `${kstTime.format(version.reviewRequestedAt)} 요청 · ` : ""}
            {version.reviewRequestNote || "메모 없음"}. 공개 · 반려되면 사이트 알림과 메일로 알려 드립니다.
          </Notice>
        ) : null}
        {version.status === "published" ? (
          <Notice tone="done" title="공개 중인 버전입니다">
            <Link href={`/learn/${course.slug}`}>수강생 화면으로 보기 →</Link>
          </Notice>
        ) : null}
      </div>

      <VersionReport data={data} base="/instructor" />

      {requestable ? (
        <section className="mt-10 border-t border-line-strong pt-6">
          <p className="mt-0 mb-6 text-[14px] text-ink-2">
            위 챕터를 눌러 수강생이 볼 화면 그대로 확인한 뒤 요청해 주세요. 영상 자리는{" "}
            <Link href={`/instructor/courses/${course.id}#slots`}>영상 연결</Link>에서 채울 수 있습니다 (연결
            안 된 자리는 수강생에게 보이지 않습니다).
          </p>
          <ReviewRequestForm versionId={version.id} again={version.status === "rejected"} />
        </section>
      ) : null}
      {version.status === "invalid" ? (
        <p className="mt-8 text-ink-2">검사 오류를 고쳐 같은 버전으로 다시 올려 주세요.</p>
      ) : null}
    </>
  );
}
