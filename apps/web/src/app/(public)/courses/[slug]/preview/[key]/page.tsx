import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonoLabel, Notice } from "@aionit/ui";
import { Reader } from "@/components/reader";
import { previewChapter } from "@/server/catalog";
import { getDb } from "@/server/db";

type Params = Promise<{ slug: string; key: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, key } = await params;
  const data = await previewChapter(getDb(), slug, key);
  return { title: data ? `${data.chapter.title} 미리보기` : "미리보기" };
}

// P-04 무료 미리보기: 운영자가 정한 챕터 · Section 을 로그인 없이 본다
export default async function PreviewPage({ params }: { params: Params }) {
  const { slug, key } = await params;
  const data = await previewChapter(getDb(), slug, key);
  if (!data) notFound();
  const { detail, chapter, html, partial, toc } = data;
  return (
    <div className="mx-auto grid max-w-[1296px] gap-12 px-5 pt-12 md:px-14 lg:grid-cols-[240px_1fr]">
      <nav aria-label="목차" className="hidden lg:block">
        <div className="sticky top-6 flex flex-col gap-2 text-[14px]">
          <Link href={`/courses/${detail.course.slug}`} className="mb-3">
            ← {detail.course.title}
          </Link>
          <MonoLabel className="text-xs text-signal">{chapter.label || chapter.key}</MonoLabel>
          {toc
            .filter((t) => t.level === 1)
            .map((t) => (
              <a key={t.id} href={`#${t.id}`} className="py-1 text-ink no-underline hover:text-signal">
                {t.title}
              </a>
            ))}
        </div>
      </nav>
      <article className="min-w-0">
        <div className="mb-6 flex flex-col gap-3 lg:hidden">
          <Link href={`/courses/${detail.course.slug}`}>← {detail.course.title}</Link>
        </div>
        <Notice tone="info" title="무료 미리보기">
          {partial ? "이 챕터의 일부 Section 을 무료로 보여 드립니다. " : ""}
          교재 전체 · 실습 파일 · 스스로 확인 · 강의 Q&A 는 수강생에게 열립니다.
        </Notice>
        <div className="mt-6">
          <Reader html={html} />
        </div>
      </article>
    </div>
  );
}
