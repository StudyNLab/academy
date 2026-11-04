import { notFound, redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { resumeChapter } from "@/server/learning";
import { requireViewer } from "@/server/session";

// /learn/{slug} ➔ 이어서 볼 챕터. 수강권 확인은 챕터 화면에서 한다 (없으면 L-05)
export default async function ResumePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireViewer(`/learn/${slug}`);
  const key = await resumeChapter(getDb(), viewer, slug);
  if (!key) notFound();
  redirect(`/learn/${slug}/${key}`);
}
