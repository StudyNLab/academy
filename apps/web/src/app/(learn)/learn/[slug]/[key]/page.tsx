import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccessNotice } from "@/components/learn/access-notice";
import { LearnScreen } from "@/components/learn/learn-screen";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { courseOffers } from "@/server/commerce";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { learnChapter, learnChapterTitle } from "@/server/learning";
import { paymentsEnabled } from "@/server/payments";
import { openQuestionCount } from "@/server/qna";
import { getViewer } from "@/server/session";

type Params = Promise<{ slug: string; key: string }>;

// 탭 제목은 장 제목. 수강권이 없는 사람(안내 화면 · 로그인으로 보냄)에게는 일반 제목만
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, key } = await params;
  const title = await learnChapterTitle(getDb(), await getViewer(), slug, key);
  return { title: title ?? "학습", robots: { index: false } };
}

// L-02 학습 화면 (docs/화면상세기획.md 1장). 수강권이 없으면 미리보기 챕터는 미리보기로, 아니면 L-05
export default async function LearnPage({ params }: { params: Params }) {
  const { slug, key } = await params;
  const viewer = await getViewer();
  const db = getDb();
  const result = await learnChapter(db, viewer, slug, key, new URL(getEnv().BETTER_AUTH_URL).origin);
  if (result.kind === "not_found") notFound();
  if (result.kind === "denied") {
    if (result.hasPreview) redirect(`/courses/${slug}/preview/${key}`);
    if (!viewer || result.access.kind !== "learner")
      redirect(`/login?next=${encodeURIComponent(`/learn/${slug}/${key}`)}`);
    const access = result.access.access;
    const offers = paymentsEnabled() ? await courseOffers(db, result.course, viewer) : null;
    return (
      <>
        <SiteHeader />
        <main>
          <AccessNotice
            course={result.course}
            reason={access.ok ? "none" : access.reason}
            lastEndedAt={access.ok ? undefined : access.lastEndedAt}
            previewKey={result.firstPreviewKey}
            offers={offers}
            returnTo={`/learn/${slug}/${key}`}
          />
        </main>
        <SiteFooter />
      </>
    );
  }
  const qnaCount = await openQuestionCount(db, result.course.id, key);
  return <LearnScreen data={result} nickname={viewer!.nickname} qnaCount={qnaCount} />;
}
