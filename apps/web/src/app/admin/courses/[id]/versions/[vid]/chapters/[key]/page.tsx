import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/page-title";
import { Reader } from "@/components/reader";
import { adminChapter } from "@/server/catalog";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";

export const metadata: Metadata = { title: "교재 미리보기" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 운영자 미리보기: 공개 전 버전도 전체 본문, 연결 안 된 영상 자리는 "영상 연결 필요"로 보인다
export default async function AdminChapterPreview({
  params,
}: {
  params: Promise<{ id: string; vid: string; key: string }>;
}) {
  const { id, vid, key } = await params;
  await requireStaff("operator", `/admin/courses/${id}/versions/${vid}/chapters/${key}`);
  if (!UUID.test(vid)) notFound();
  const data = await adminChapter(getDb(), vid, key);
  if (!data || data.course.id !== id) notFound();
  return (
    <>
      <PageTitle label={`Preview · v${data.version.version} · ${key}`} title={data.chapter.title}>
        <p className="m-0">
          <Link href={`/admin/courses/${id}/versions/${vid}`}>← 검수로</Link> · 운영자 미리보기 (수강생 학습
          화면은 M3)
        </p>
      </PageTitle>
      <Reader html={data.html} />
    </>
  );
}
