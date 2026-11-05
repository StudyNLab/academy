import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot } from "@aionit/ui";
import { kstTime } from "@/components/course-manage";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { reviewQueue } from "@/server/instructors";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "검수 대기" };

// AD-04 검수 대기 목록: 과정 · 강사 · 버전 · 요청일 · 강사 메모, 오래 기다린 순
export default async function AdminReviews() {
  await requireStaff("operator", "/admin/reviews");
  const rows = await reviewQueue(getDb());
  return (
    <>
      <PageTitle label="Reviews" title="검수 대기">
        <p className="m-0">
          강사가 검수를 요청한 버전과, 운영자가 올려 검사를 통과한 버전입니다. 강사가 올리고 아직 요청하지
          않은 버전은 보이지 않습니다.
        </p>
      </PageTitle>
      {rows.length === 0 ? <p className="text-ink-2">검수할 버전이 없습니다.</p> : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 border-b border-line py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/admin/courses/${r.courseId}/versions/${r.id}`} className="text-[15px]">
                {r.courseTitle} <span className="font-mono">v{r.version}</span>
              </Link>
              <StatusDot tone="warn">{r.status === "in_review" ? "강사 요청" : "운영자 올림"}</StatusDot>
            </div>
            <p className="m-0 text-[13px] text-ink-2">
              강사 {r.instructor} · {kstTime.format(r.waitingSince)}
              {r.publishedVersionId ? " · 새 버전" : " · 첫 공개"}
              {r.note ? ` · 메모: ${r.note}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
