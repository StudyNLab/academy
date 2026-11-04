import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, MonoLabel } from "@aionit/ui";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { youtubeEmbed } from "@/server/content-render";
import { courseDetail, FIELD_LABEL } from "@/server/catalog";
import { getDb } from "@/server/db";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const detail = await courseDetail(getDb(), (await params).slug);
  return detail ? { title: detail.course.title, description: detail.course.summary } : { title: "강의" };
}

const KIND_LABEL = { main: "챕터 강의", lab: "실습 시연", extra: "추가 설명" } as const;

function Block({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line-strong pt-6">
      <MonoLabel className="text-xs text-signal">{label}</MonoLabel>
      <h2 className="mt-2 mb-5 text-[26px] font-semibold tracking-[-0.025em]">{title}</h2>
      {children}
    </section>
  );
}

// P-03 강의 상세. 가격 · 구매(M5) · 구독(M6) · 강사 소개(M8) · 수강권별 카드 상태(M3)는 해당 단계에서 채운다
export default async function CoursePage({ params }: { params: Params }) {
  const detail = await courseDetail(getDb(), (await params).slug);
  if (!detail) notFound();
  const { course, instructor, chapters } = detail;
  const videos = chapters.flatMap((c) => c.videos);
  const freeVideos = videos.filter((v) => v.source === "youtube");
  const labs = chapters.reduce((n, c) => n + c.labs.length, 0);
  const firstFree = chapters.flatMap((c) => c.videos).find((v) => v.source === "youtube" && v.youtubeVideoId);
  const firstPreview = chapters.find((c) => c.preview);

  return (
    <div className="mx-auto grid max-w-[1296px] gap-14 px-5 pt-16 md:px-14 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-14">
        <header className="flex flex-col gap-4">
          <MonoLabel className="text-xs text-signal">
            {FIELD_LABEL[course.field]}
            {course.level ? ` · ${course.level}` : ""}
          </MonoLabel>
          <h1 className="m-0 text-[36px] leading-[1.15] font-semibold tracking-[-0.035em] md:text-[52px]">
            {course.title}
          </h1>
          {course.summary ? (
            <p className="m-0 text-[19px] leading-[1.7] font-light text-ink-2">{course.summary}</p>
          ) : null}
          <p className="m-0 text-[14px] text-ink-2">
            강사 {instructor.displayName} · {chapters.length} CHAPTER · 실습 {labs}개 · 무료 공개 영상{" "}
            {freeVideos.length}개
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {firstPreview ? (
              <Link
                href={`/courses/${course.slug}/preview/${firstPreview.key}`}
                className={buttonClass("outline", "md")}
              >
                무료 미리보기
              </Link>
            ) : null}
          </div>
          {firstFree?.youtubeVideoId ? (
            <figure className="m-0 mt-4">
              <div
                className="reader max-w-none"
                dangerouslySetInnerHTML={{ __html: youtubeEmbed(firstFree.youtubeVideoId, firstFree.title) }}
              />
              <figcaption className="mt-2 border-b-[3px] border-signal pb-2 text-[13px] text-ink-2">
                {firstFree.title} · 무료 공개
              </figcaption>
            </figure>
          ) : null}
        </header>

        {course.audienceMd ? (
          <Block label="For you" title="이런 분께">
            <SimpleMarkdown source={course.audienceMd} />
          </Block>
        ) : null}

        <Block label="Free vs. enrolled" title="무료로 볼 수 있는 것 · 수강하면 얻는 것">
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr className="border-y-2 border-line-strong text-left font-mono text-[12px]">
                <th className="px-2 py-2.5"> </th>
                <th className="px-2 py-2.5 text-center">누구나</th>
                <th className="px-2 py-2.5 text-center">수강생</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["챕터 강의 영상 (유튜브 공개분)", true, true],
                ["수강생 전용 영상", false, true],
                ["교재 전체 (그림 · 코드 · 실습 안내)", "미리보기만", true],
                ["실습 파일 · 완성 코드", false, true],
                ["실습 평가 기준 · 스스로 확인", false, true],
                ["강의 Q&A (강사 답변)", false, true],
                ["진도 관리 · 이어서 학습", false, true],
              ].map(([label, free, paid]) => (
                <tr key={String(label)} className="border-b border-line">
                  <td className="px-2 py-2.5">{label}</td>
                  <td className="px-2 py-2.5 text-center">{free === true ? "✓" : free || "-"}</td>
                  <td className="px-2 py-2.5 text-center">{paid ? "✓" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>

        <Block label="Curriculum" title="커리큘럼">
          <ol className="m-0 list-none border-t border-line p-0">
            {chapters.map((chapter) => (
              <li key={chapter.key} className="border-b border-line py-4">
                <details>
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1">
                    <MonoLabel className="text-xs text-signal">{chapter.label || chapter.key}</MonoLabel>
                    <span className="text-[18px] font-semibold">{chapter.title}</span>
                    {chapter.preview ? (
                      <Link href={`/courses/${course.slug}/preview/${chapter.key}`} className="text-[14px]">
                        미리보기 →
                      </Link>
                    ) : null}
                  </summary>
                  <ul className="mt-3 mb-0 flex list-none flex-col gap-1.5 pl-0 text-[15px] text-ink-2">
                    {chapter.videos.map((v) => (
                      <li key={v.key}>
                        {v.source === "youtube" ? (
                          <span className="text-signal">▶ {KIND_LABEL[v.kind]} · 무료 공개</span>
                        ) : (
                          <span>· {KIND_LABEL[v.kind]} · 수강생 전용</span>
                        )}{" "}
                        <span className="text-ink">{v.title}</span>
                      </li>
                    ))}
                    {chapter.toc
                      .filter((t) => t.level === 1)
                      .map((t) => (
                        <li key={t.id}>
                          {t.lab ? <span className="text-done">실습</span> : "·"} {t.title}
                        </li>
                      ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
        </Block>

        {course.requirementsMd ? (
          <Block label="Requirements" title="실습 준비물">
            <SimpleMarkdown source={course.requirementsMd} />
          </Block>
        ) : null}

        {course.descriptionMd ? (
          <Block label="About" title="강의 소개">
            <SimpleMarkdown source={course.descriptionMd} />
          </Block>
        ) : null}
      </div>

      {/* 구매 카드 자리. 가격 · 구매(M5), 구독(M6), 수강 중 상태(M3)를 이 자리에 넣는다 */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="flex flex-col gap-4 border-t-2 border-line-strong bg-surface p-6 shadow-float">
          <MonoLabel className="text-xs text-ink-2">수강 안내</MonoLabel>
          <p className="m-0 text-[22px] font-semibold">곧 판매를 시작합니다</p>
          <p className="m-0 text-[14px] leading-[1.7] text-ink-2">
            {course.inSubscription ? "구독하면 이 강의를 들을 수 있습니다." : "프리미엄 강의 (구독자 할인)"}
          </p>
          {firstPreview ? (
            <Link
              href={`/courses/${course.slug}/preview/${firstPreview.key}`}
              className={buttonClass("primary", "lg", "w-full")}
            >
              무료 미리보기
            </Link>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
