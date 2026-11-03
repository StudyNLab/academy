import type { Metadata } from "next";
import Link from "next/link";
import type { CourseField } from "@aionit/db";
import { COURSE_FIELDS } from "@aionit/db";
import { CourseList } from "@/components/course-list";
import { PageTitle } from "@/components/page-title";
import { FIELD_LABEL, listCatalog } from "@/server/catalog";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "강의" };

// P-02 강의 목록: 분야 필터 (강사별 · 정렬은 강의가 늘면 더한다)
export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ field?: string }> }) {
  const raw = (await searchParams).field;
  const field = (COURSE_FIELDS as readonly string[]).includes(raw ?? "") ? (raw as CourseField) : undefined;
  const courses = await listCatalog(getDb(), { field });
  const filters: { href: string; label: string; active: boolean }[] = [
    { href: "/courses", label: "전체", active: !field },
    ...COURSE_FIELDS.map((f) => ({
      href: `/courses?field=${f}`,
      label: FIELD_LABEL[f],
      active: field === f,
    })),
  ];
  return (
    <div className="mx-auto max-w-[1296px] px-5 pt-16 md:px-14">
      <PageTitle label="Courses" title="강의">
        <p className="m-0">영상으로 개념을 잡고, 교재로 정리하고, 실습 기준으로 스스로 확인합니다.</p>
      </PageTitle>
      <nav aria-label="분야" className="mb-6 flex flex-wrap gap-x-6">
        {filters.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            aria-current={f.active ? "page" : undefined}
            className="inline-flex min-h-11 items-center text-ink no-underline aria-[current=page]:font-semibold aria-[current=page]:text-signal"
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <CourseList courses={courses} />
    </div>
  );
}
