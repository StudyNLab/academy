import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, schema } from "@aionit/db";
import { StatusDot } from "@aionit/ui";
import { CourseManage, ManageSection } from "@/components/course-manage";
import { PageTitle } from "@/components/page-title";
import { adminCourse, FIELD_LABEL } from "@/server/catalog";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";
import { EditCourseForm } from "../course-forms";
import { VisibilityToggle } from "./course-admin-forms";

export const metadata: Metadata = { title: "과정 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// AD-02 과정 상세 · AD-03 패키지 올리기 · AD-05 영상 관리(자체 서버 영상 · 유튜브 연결) · AD-06 무료 미리보기 · 첨부 자료
export default async function AdminCourse({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff("operator", `/admin/courses/${id}`);
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const data = await adminCourse(db, id);
  if (!data) notFound();
  const { course, instructor } = data;
  const instructors = await db
    .select({ id: schema.instructors.id, name: schema.instructors.displayName })
    .from(schema.instructors)
    .orderBy(asc(schema.instructors.displayName));

  return (
    <>
      <PageTitle label={`Course · ${course.slug}`} title={course.title}>
        <p className="m-0">
          {FIELD_LABEL[course.field]} · {course.level || "수준 미정"} · 강사{" "}
          <Link href={`/admin/instructors/${instructor.id}`}>{instructor.displayName}</Link> ·{" "}
          {course.inSubscription ? "구독 포함" : "프리미엄"}
        </p>
      </PageTitle>
      <div className="flex flex-wrap items-center gap-4">
        <StatusDot
          tone={course.status === "published" ? "done" : course.status === "hidden" ? "warn" : "muted"}
        >
          {course.status === "published" ? "공개" : course.status === "hidden" ? "숨김" : "작성 중"}
        </StatusDot>
        {course.status !== "draft" ? (
          <>
            <Link href={`/courses/${course.slug}`}>공개 화면 보기 →</Link>
            <VisibilityToggle courseId={course.id} hidden={course.status === "hidden"} />
          </>
        ) : null}
      </div>

      <CourseManage db={db} data={data} base="/admin" />

      <ManageSection title="과정 정보">
        <div className="max-w-[640px]">
          <EditCourseForm
            courseId={course.id}
            instructors={instructors}
            initial={{
              title: course.title,
              field: course.field,
              level: course.level,
              ownerInstructorId: course.ownerInstructorId,
              summary: course.summary,
              descriptionMd: course.descriptionMd,
              audienceMd: course.audienceMd,
              requirementsMd: course.requirementsMd,
              inSubscription: course.inSubscription,
            }}
          />
        </div>
      </ManageSection>
    </>
  );
}
