import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, schema } from "@aionit/db";
import { StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import type { TocItem } from "@/server/catalog";
import { adminCourse, FIELD_LABEL } from "@/server/catalog";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";
import { EditCourseForm } from "../course-forms";
import { VERSION_STATUS } from "../version-status";
import {
  AttachmentForm,
  AttachmentRemove,
  AutoRefresh,
  PreviewRuleForm,
  UploadPackageForm,
  VideoSlotForm,
  VisibilityToggle,
} from "./course-admin-forms";

export const metadata: Metadata = { title: "과정 상세" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "short",
  timeStyle: "short",
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 border-t border-line-strong pt-6">
      <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  );
}

// AD-02 과정 상세 · AD-03 패키지 올리기 · AD-05 영상 연결(유튜브) · AD-06 무료 미리보기 · 첨부 자료
export default async function AdminCourse({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff("operator", `/admin/courses/${id}`);
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const data = await adminCourse(db, id);
  if (!data) notFound();
  const { course, instructor, versions, slots, previews, attachments, publishedChapters } = data;
  const instructors = await db
    .select({ id: schema.instructors.id, name: schema.instructors.displayName })
    .from(schema.instructors)
    .orderBy(asc(schema.instructors.displayName));
  const previewByChapter = new Map(previews.map((p) => [p.chapterKey, p]));
  const processing = versions.some((v) => v.status === "uploaded" || v.status === "processing");

  return (
    <>
      <PageTitle label={`Course · ${course.slug}`} title={course.title}>
        <p className="m-0">
          {FIELD_LABEL[course.field]} · {course.level || "수준 미정"} · 강사 {instructor.displayName} ·{" "}
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

      <Section title="교재 버전">
        {processing ? <AutoRefresh /> : null}
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-y-2 border-line-strong text-left font-mono text-[12px]">
              <th className="px-2 py-2">버전</th>
              <th className="px-2 py-2">상태</th>
              <th className="px-2 py-2">검사</th>
              <th className="px-2 py-2 text-right">올린 때</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => {
              const report = v.validationReport as { errors?: unknown[]; warnings?: unknown[] } | null;
              const status = VERSION_STATUS[v.status];
              return (
                <tr key={v.id} className="border-b border-line">
                  <td className="px-2 py-2.5">
                    <Link href={`/admin/courses/${course.id}/versions/${v.id}`} className="font-mono">
                      v{v.version}
                    </Link>
                  </td>
                  <td className="px-2 py-2.5">
                    <StatusDot tone={status.tone}>{status.label}</StatusDot>
                  </td>
                  <td className="px-2 py-2.5 text-ink-2">
                    {report
                      ? `오류 ${report.errors?.length ?? 0} · 경고 ${report.warnings?.length ?? 0}`
                      : "-"}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{time.format(v.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {versions.length === 0 ? <p className="text-ink-2">아직 올린 교재가 없습니다.</p> : null}
        <div className="mt-6 max-w-[560px]">
          <UploadPackageForm courseId={course.id} slug={course.slug} />
        </div>
      </Section>

      <Section title="영상 연결 (유튜브)">
        <p className="mt-0 text-[14px] text-ink-2">
          교재의 영상 자리(key)마다 유튜브 주소를 넣습니다. 유튜브 영상은 누구나 볼 수 있는 무료 공개 영상으로
          보입니다. 자체 서버 영상(수강생 전용)은 M4 에서 더합니다. 연결 안 된 자리는 수강생 화면에 보이지
          않습니다.
        </p>
        {slots.length === 0 ? <p className="text-ink-2">교재를 올리면 영상 자리가 생깁니다.</p> : null}
        <ul className="m-0 flex list-none flex-col p-0">
          {slots.map((slot) => (
            <li key={slot.id} className="border-b border-line py-3">
              <VideoSlotForm
                slotId={slot.id}
                label={`${slot.chapterKey} · ${slot.kind === "main" ? "챕터 영상" : slot.kind === "lab" ? "실습 시연" : "추가 설명"} · ${slot.title}`}
                videoKey={slot.key}
                youtubeVideoId={slot.youtubeVideoId}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="무료 미리보기">
        {publishedChapters.length === 0 ? (
          <p className="text-ink-2">교재를 공개하면 챕터마다 미리보기 범위를 정할 수 있습니다.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {publishedChapters.map((chapter) => {
              const rule = previewByChapter.get(chapter.key);
              const sections = (chapter.toc as TocItem[]).filter((t) => t.level === 1);
              return (
                <li key={chapter.key} className="border-b border-line py-3">
                  <PreviewRuleForm
                    courseId={course.id}
                    chapterKey={chapter.key}
                    title={chapter.title}
                    sections={sections.map((s) => ({ id: s.id, title: s.title }))}
                    initialScope={rule?.scope ?? "none"}
                    initialSections={(rule?.sectionIds as string[] | undefined) ?? []}
                    previewHref={`/courses/${course.slug}/preview/${chapter.key}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="첨부 자료 (실습 파일)">
        <p className="mt-0 text-[14px] text-ink-2">
          챕터마다 실습 파일 zip 을 올립니다. 수강생이 받는 화면은 수강권 판단과 함께 M3 에서 엽니다.
        </p>
        <ul className="m-0 mb-6 flex list-none flex-col p-0">
          {attachments.map(({ attachment, file }) => (
            <li
              key={attachment.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2.5"
            >
              <span>
                <span className="font-mono text-[12px] text-ink-2">
                  {attachment.chapterKey ?? "과정 전체"}
                </span>{" "}
                {attachment.title}{" "}
                <span className="text-[13px] text-ink-2">({(file.size / 1048576).toFixed(1)}MB)</span>
              </span>
              <span className="flex items-center gap-4">
                <a href={`/api/v1/admin/attachments/${attachment.id}`}>받기</a>
                <AttachmentRemove attachmentId={attachment.id} />
              </span>
            </li>
          ))}
        </ul>
        <div className="max-w-[560px]">
          <AttachmentForm
            courseId={course.id}
            chapters={publishedChapters.map((c) => ({ key: c.key, title: c.title }))}
          />
        </div>
      </Section>

      <Section title="과정 정보">
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
      </Section>
    </>
  );
}
