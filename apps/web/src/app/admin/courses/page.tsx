import type { Metadata } from "next";
import Link from "next/link";
import { asc, count, eq, schema } from "@aionit/db";
import { StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { adminCourseList, FIELD_LABEL } from "@/server/catalog";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";
import { InstructorRemove, NewCourseForm } from "./course-forms";

export const metadata: Metadata = { title: "과정 관리" };

const STATUS = {
  draft: { tone: "muted", label: "작성 중" },
  published: { tone: "done", label: "공개" },
  hidden: { tone: "warn", label: "숨김" },
} as const;

// AD-02 과정 목록 · 등록
export default async function AdminCourses() {
  await requireStaff("operator", "/admin/courses");
  const db = getDb();
  const courses = await adminCourseList(db);
  const instructors = await db
    .select({
      id: schema.instructors.id,
      name: schema.instructors.displayName,
      courses: count(schema.courses.id),
    })
    .from(schema.instructors)
    .leftJoin(schema.courses, eq(schema.courses.ownerInstructorId, schema.instructors.id))
    .groupBy(schema.instructors.id)
    .orderBy(asc(schema.instructors.displayName));

  return (
    <>
      <PageTitle label="Courses" title="과정" />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-y-2 border-line-strong text-left font-mono text-[12px] tracking-[0.04em]">
              <th className="px-2 py-2.5">과정</th>
              <th className="px-2 py-2.5">분야</th>
              <th className="px-2 py-2.5">강사</th>
              <th className="px-2 py-2.5">상태</th>
              <th className="px-2 py-2.5">공개 버전</th>
              <th className="px-2 py-2.5">검수 대기</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id} className="border-b border-line">
                <td className="px-2 py-3">
                  <Link href={`/admin/courses/${c.id}`}>{c.title}</Link>
                  <div className="font-mono text-[12px] text-ink-2">{c.slug}</div>
                </td>
                <td className="px-2 py-3">{FIELD_LABEL[c.field]}</td>
                <td className="px-2 py-3">{c.instructor}</td>
                <td className="px-2 py-3">
                  <StatusDot tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusDot>
                </td>
                <td className="px-2 py-3 font-mono text-[13px]">
                  {c.publishedVersion ? `v${c.publishedVersion}` : "-"}
                </td>
                <td className="px-2 py-3 tabular-nums">{c.waiting || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {courses.length === 0 ? (
          <p className="py-6 text-ink-2">등록한 과정이 없습니다. 아래에서 첫 과정을 만드세요.</p>
        ) : null}
      </div>
      <section className="mt-12 max-w-[640px] border-t border-line-strong pt-6">
        <h2 className="m-0 mb-5 text-[21px] font-semibold tracking-[-0.02em]">새 과정 등록</h2>
        <NewCourseForm instructors={instructors} />
      </section>
      <section className="mt-12 max-w-[640px] border-t border-line-strong pt-6">
        <h2 className="m-0 mb-2 text-[21px] font-semibold tracking-[-0.02em]">강사</h2>
        <p className="m-0 mb-4 text-[13px] text-ink-2">
          맡은 과정이 없는 강사만 지울 수 있습니다. 과정이 있으면 과정의 강사를 먼저 바꾸세요.
        </p>
        <ul className="m-0 list-none p-0 text-[14px]">
          {instructors.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 border-b border-line py-1">
              <span>
                {i.name}
                <span className="ml-2 text-ink-2">{i.courses ? `과정 ${i.courses}개` : "맡은 과정 없음"}</span>
              </span>
              {i.courses === 0 ? <InstructorRemove instructorId={i.id} name={i.name} /> : null}
            </li>
          ))}
          {instructors.length === 0 ? <li className="py-2.5 text-ink-2">없음</li> : null}
        </ul>
      </section>
    </>
  );
}
