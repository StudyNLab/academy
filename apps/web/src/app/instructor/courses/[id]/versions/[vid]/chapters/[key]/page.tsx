import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/page-title";
import { Reader } from "@/components/reader";
import { adminChapter } from "@/server/catalog";
import { isUuid, ownCoursePage } from "@/server/instructor-page";

export const metadata: Metadata = { title: "교재 미리보기" };

// I-05 미리보기: 공개 전 버전도 전체 본문 (수강생이 볼 모습 그대로). 연결 안 된 영상 자리는 "영상 연결 필요"로 보인다
export default async function InstructorChapterPreview({
  params,
}: {
  params: Promise<{ id: string; vid: string; key: string }>;
}) {
  const { id, vid, key } = await params;
  const { db, course } = await ownCoursePage(id, `/instructor/courses/${id}/versions/${vid}/chapters/${key}`);
  if (!isUuid(vid)) notFound();
  const data = await adminChapter(db, vid, key);
  if (!data || data.course.id !== course.id) notFound();
  return (
    <>
      <PageTitle label={`Preview · v${data.version.version} · ${key}`} title={data.chapter.title}>
        <p className="m-0">
          <Link href={`/instructor/courses/${id}/versions/${vid}`}>← 버전으로</Link> · 공개 전 미리보기
        </p>
      </PageTitle>
      <Reader html={data.html} />
    </>
  );
}
