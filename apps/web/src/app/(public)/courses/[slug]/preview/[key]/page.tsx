import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, MonoLabel, Notice } from "@aionit/ui";
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
  const shown = new Set(toc.map((t) => t.id));
  const locked = partial ? chapter.toc.filter((t) => t.level === 1 && !shown.has(t.id)) : [];
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
        {locked.length > 0 ? (
          <section
            aria-label="수강하면 볼 수 있는 Section"
            className="mx-auto mt-12 max-w-[720px] border-t border-line-strong pt-6"
          >
            <MonoLabel className="text-xs text-ink-2">이 챕터의 나머지</MonoLabel>
            <ul className="mt-3 mb-6 flex list-none flex-col p-0 text-[16px]">
              {locked.map((t) => (
                <li key={t.id} className="border-b border-line py-3 text-ink-2">
                  {t.title}
                  <span className="ml-2 font-mono text-[11px] tracking-[0.04em]">수강생 전용</span>
                </li>
              ))}
            </ul>
            <p className="m-0 mb-4 text-[15px]">수강하면 볼 수 있습니다.</p>
            <Link href={`/courses/${detail.course.slug}`} className={buttonClass("primary", "md")}>
              수강 안내 보기
            </Link>
          </section>
        ) : null}
      </article>
    </div>
  );
}
