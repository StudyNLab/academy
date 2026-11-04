import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { requireStaff } from "@/server/session";
import { courseVideos } from "@/server/videos";
import { AdminVideoPlayer } from "../../video-forms";

export const metadata: Metadata = { title: "영상 보기" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// AD-05: 변환 결과 확인 (화질 · 비트레이트 · 자막 · 워터마크). 수강생과 같은 재생 경로(토큰 · 키 서버)를 쓴다
export default async function AdminVideo({ params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  await requireStaff("operator", `/admin/courses/${id}/videos/${vid}`);
  if (!UUID.test(id) || !UUID.test(vid)) notFound();
  const video = (await courseVideos(getDb(), id)).find((v) => v.id === vid);
  if (!video) notFound();
  return (
    <>
      <PageTitle label="Video" title={video.title}>
        <p className="m-0">
          <Link href={`/admin/courses/${id}`}>← 과정으로</Link> · {video.originalName}
        </p>
      </PageTitle>
      {video.status === "ready" ? (
        <div className="max-w-[960px]">
          <AdminVideoPlayer assetId={video.id} title={video.title} />
        </div>
      ) : (
        <p className="text-ink-2">변환이 끝나면 여기서 볼 수 있습니다.</p>
      )}
      <table className="mt-8 w-full max-w-[640px] border-collapse text-[14px]">
        <thead>
          <tr className="border-y-2 border-line-strong text-left font-mono text-[12px]">
            <th className="px-2 py-2">화질</th>
            <th className="px-2 py-2">크기</th>
            <th className="px-2 py-2 text-right">평균 (영상 + 소리)</th>
            <th className="px-2 py-2 text-right">영상 상한</th>
          </tr>
        </thead>
        <tbody>
          {video.renditions.map((r) => (
            <tr key={r.name} className="border-b border-line">
              <td className="px-2 py-2.5 font-mono">{r.name}</td>
              <td className="px-2 py-2.5 tabular-nums">
                {r.width}×{r.height}
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">{r.avgKbps} kbps</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{r.maxrateKbps} kbps</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-[13px] text-ink-2">
        원본 {video.width}×{video.height} · {video.durationSec ?? "-"}초 · 자막{" "}
        {video.subtitles.length > 0
          ? video.subtitles.map((s) => `${s.lang} (${s.cues}줄)`).join(", ")
          : "없음"}{" "}
        · 연결된 자리 {video.linkedKeys.length > 0 ? video.linkedKeys.join(", ") : "없음"}
      </p>
    </>
  );
}
