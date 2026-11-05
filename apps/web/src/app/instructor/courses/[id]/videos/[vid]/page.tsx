import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminVideoPlayer } from "@/app/admin/courses/[id]/video-forms";
import { PageTitle } from "@/components/page-title";
import { isUuid, ownCoursePage } from "@/server/instructor-page";
import { courseVideos } from "@/server/videos";

export const metadata: Metadata = { title: "영상 보기" };

// I-04: 내가 올린 영상의 변환 결과 확인 (수강생과 같은 재생 경로 · 워터마크)
export default async function InstructorVideo({ params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  const { db, course } = await ownCoursePage(id, `/instructor/courses/${id}/videos/${vid}`);
  if (!isUuid(vid)) notFound();
  const video = (await courseVideos(db, course.id)).find((v) => v.id === vid);
  if (!video) notFound();
  return (
    <>
      <PageTitle label="Video" title={video.title}>
        <p className="m-0 break-all">
          <Link href={`/instructor/courses/${id}#videos`}>← 내 강의로</Link> · {video.originalName}
        </p>
      </PageTitle>
      {video.status === "ready" ? (
        <div className="max-w-[960px]">
          <AdminVideoPlayer assetId={video.id} title={video.title} base="/instructor" />
        </div>
      ) : (
        <p className="text-ink-2">변환이 끝나면 여기서 볼 수 있습니다.</p>
      )}
      <p className="mt-6 text-[13px] text-ink-2">
        {video.renditions.map((r) => `${r.name} 평균 ${r.avgKbps}kbps`).join(" · ") || "화질 정보 없음"} ·
        자막 {video.subtitles.length > 0 ? video.subtitles.map((s) => s.lang).join(", ") : "없음"} · 연결된
        자리 {video.linkedKeys.length > 0 ? video.linkedKeys.join(", ") : "없음"}
      </p>
    </>
  );
}
