import Link from "next/link";
import { MonoLabel } from "@aionit/ui";
import type { CatalogItem } from "@/server/catalog";
import { FIELD_LABEL } from "@/server/catalog";

/** 강의 목록: 카드 그리드 대신 줄 목록 — 번호 · 강의 · 분야 · 구성 · 수강 방법 (디자인시스템 4장) */
export function CourseList({ courses }: { courses: CatalogItem[] }) {
  if (courses.length === 0) {
    return <p className="border-t border-line-strong py-10 text-[16px] text-ink-2">곧 첫 강의가 열립니다.</p>;
  }
  return (
    <ol className="m-0 list-none border-t border-line-strong p-0">
      {courses.map((course, i) => (
        <li key={course.id} className="border-b border-line">
          <Link
            href={`/courses/${course.slug}`}
            className="grid gap-x-8 gap-y-2 py-7 text-ink no-underline hover:bg-sunken hover:text-ink md:grid-cols-[64px_1fr_120px_200px_140px] md:items-baseline md:px-2"
          >
            <MonoLabel className="text-xs text-signal">{String(i + 1).padStart(2, "0")}</MonoLabel>
            <span className="flex flex-col gap-1.5">
              <span className="text-[22px] leading-[1.35] font-semibold tracking-[-0.02em]">
                {course.title}
              </span>
              {course.summary ? (
                <span className="text-[15px] leading-[1.6] text-ink-2">{course.summary}</span>
              ) : null}
              <span className="text-[13px] text-ink-2">강사 {course.instructor}</span>
            </span>
            <span className="text-[14px] text-ink-2">
              {FIELD_LABEL[course.field]}
              {course.level ? ` · ${course.level}` : ""}
            </span>
            <span className="text-[14px] text-ink-2">
              {course.chapters} CHAPTER · 실습 {course.labs}개
              {course.freeVideos ? (
                <span className="text-signal"> · 무료 공개 영상 {course.freeVideos}</span>
              ) : null}
            </span>
            <span className="text-[14px]">
              {course.inSubscription ? "구독 포함" : <strong>프리미엄</strong>}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
