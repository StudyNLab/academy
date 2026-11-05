import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, StatusDot } from "@aionit/ui";
import { kstTime } from "@/components/course-manage";
import { PageTitle } from "@/components/page-title";
import { VersionReport } from "@/components/version-report";
import { adminVersion } from "@/server/catalog";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";
import { VERSION_STATUS } from "../../../version-status";
import { AutoRefresh } from "../../course-admin-forms";
import { ReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "검수" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// AD-04 검수 · 공개: 강사 요청 메모, 자동 검사 결과, 영상 자리, 바뀐 챕터, 미리보기, 승인 · 반려 · 되돌리기
export default async function ReviewVersion({ params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  await requireStaff("operator", `/admin/courses/${id}/versions/${vid}`);
  if (!UUID.test(vid)) notFound();
  const data = await adminVersion(getDb(), vid);
  if (!data || data.course.id !== id) notFound();
  const { version, course } = data;
  const status = VERSION_STATUS[version.status];
  const processing = version.status === "uploaded" || version.status === "processing";

  return (
    <>
      <PageTitle label={`Review · ${course.slug}`} title={`${course.title} v${version.version}`}>
        <p className="m-0">
          <Link href={`/admin/courses/${course.id}`}>← 과정으로</Link> ·{" "}
          <Link href="/admin/reviews">검수 대기 목록</Link>
        </p>
      </PageTitle>
      <StatusDot tone={status.tone}>{status.label}</StatusDot>
      {processing ? <AutoRefresh /> : null}
      {version.reviewRequestedAt ? (
        <div className="mt-4">
          <Notice tone="info" title={`강사 검수 요청 · ${kstTime.format(version.reviewRequestedAt)}`}>
            {version.reviewRequestNote || "변경 내용 메모 없음"}
          </Notice>
        </div>
      ) : null}
      {version.reviewNote ? (
        <div className="mt-4">
          <Notice tone={version.status === "rejected" ? "danger" : "info"} title="검수 메모">
            {version.reviewNote}
          </Notice>
        </div>
      ) : null}

      <VersionReport data={data} base="/admin" />

      <section className="mt-10 border-t border-line-strong pt-6">
        <ReviewActions versionId={version.id} status={version.status} courseId={course.id} />
      </section>
    </>
  );
}
