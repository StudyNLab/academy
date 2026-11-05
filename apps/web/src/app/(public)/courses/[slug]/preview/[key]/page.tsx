import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SvcIcon } from "@/components/icons";
import { Reader } from "@/components/reader";
import { previewChapter } from "@/server/catalog";
import { getDb } from "@/server/db";

type Params = Promise<{ slug: string; key: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, key } = await params;
  const data = await previewChapter(getDb(), slug, key);
  return { title: data ? `${data.chapter.title} 미리보기` : "미리보기" };
}

// P-04 무료 미리보기 (시안 #/learn?preview — 학습 화면 틀 + 위 안내 띠): 운영자가 정한 챕터 · Section 을 로그인 없이 본다
export default async function PreviewPage({ params }: { params: Params }) {
  const { slug, key } = await params;
  const data = await previewChapter(getDb(), slug, key);
  if (!data) notFound();
  const { detail, chapter, html, partial, toc } = data;
  const shown = new Set(toc.map((t) => t.id));
  const locked = partial ? chapter.toc.filter((t) => t.level === 1 && !shown.has(t.id)) : [];
  const sections = toc.filter((t) => t.level === 1);
  return (
    <>
      <div className="reader-state-banner">
        무료 미리보기입니다. {partial ? "이 챕터의 일부를 보여 드립니다. " : ""}
        교재 전체 · 실습 파일 · 스스로 확인 · 강의 Q&A 는 수강생에게 열립니다.
        <Link className="btn small secondary" href={`/courses/${detail.course.slug}`}>
          수강 안내
        </Link>
      </div>
      <div className="reader-shell">
        <aside className="toc" aria-label="강의 목차">
          <Link className="toc-back" href={`/courses/${detail.course.slug}`}>
            <SvcIcon name="back" /> 강의 안내
          </Link>
          <div className="toc-title">
            <span className="eyebrow muted">FREE PREVIEW</span>
            <h2>{detail.course.title}</h2>
          </div>
          <nav aria-label="목차">
            <span className="toc-item current" aria-current="page">
              <SvcIcon name="book" />
              <span className="num">
                {chapter.label.replace(/^CHAPTER\s*/i, "").padStart(2, "0") || chapter.key}
              </span>
              <span>{chapter.title}</span>
            </span>
            <div className="toc-sub">
              {sections.map((t) => (
                <a key={t.id} href={`#${t.id}`}>
                  {t.title}
                </a>
              ))}
              {locked.map((t) => (
                <span key={t.id} className="text-muted">
                  <SvcIcon name="lock" /> {t.title}
                </span>
              ))}
            </div>
          </nav>
        </aside>
        <div className="reader-workspace">
          <div className="reading-layout">
            <article className="reading-main">
              <Reader html={html} />
              {locked.length > 0 ? (
                <section aria-label="수강하면 볼 수 있는 Section" className="chapter-end">
                  <div className="eyebrow muted">THE REST OF THIS CHAPTER</div>
                  <h3>수강하면 이어서 볼 수 있습니다.</h3>
                  {locked.map((t) => (
                    <div key={t.id} className="completion-row">
                      <span>{t.title}</span>
                      <span>수강생 전용</span>
                    </div>
                  ))}
                  <Link href={`/courses/${detail.course.slug}`} className="btn primary mt-5">
                    수강 안내 보기 <SvcIcon name="arrow" />
                  </Link>
                </section>
              ) : null}
            </article>
          </div>
        </div>
      </div>
    </>
  );
}
