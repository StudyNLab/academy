import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, MonoLabel } from "@aionit/ui";
import { PurchaseCard } from "@/components/commerce/purchase-card";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { youtubeEmbed } from "@/server/content-render";
import { courseDetail, FIELD_LABEL } from "@/server/catalog";
import { courseOffers } from "@/server/commerce";
import { getDb } from "@/server/db";
import { viewAccess } from "@/server/entitlements";
import { paymentsEnabled } from "@/server/payments";
import { getViewer } from "@/server/session";

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

// P-03 강의 상세 (강사 소개는 M8: 강사가 강사 화면 I-09 에서 쓴 공개 프로필)
export default async function CoursePage({ params }: { params: Params }) {
  const detail = await courseDetail(getDb(), (await params).slug);
  if (!detail) notFound();
  const { course, instructor, chapters } = detail;
  const viewer = await getViewer();
  const access = await viewAccess(getDb(), viewer, course);
  const offers = await courseOffers(getDb(), course, viewer);
  const videos = chapters.flatMap((c) => c.videos);
  const freeVideos = videos.filter((v) => v.source === "youtube");
  const labs = chapters.reduce((n, c) => n + c.labs.length, 0);
  const firstFree = chapters.flatMap((c) => c.videos).find((v) => v.source === "youtube" && v.youtubeVideoId);
  const firstPreview = chapters.find((c) => c.preview);

  return (
    <div className="mx-auto grid max-w-[1296px] gap-14 px-5 pt-16 pb-24 md:px-14 lg:grid-cols-[1fr_320px] lg:pb-0">
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
            강사 <Link href={`/instructors/${instructor.id}`}>{instructor.displayName}</Link> ·{" "}
            {chapters.length} CHAPTER · 실습 {labs}개 · 무료 공개 영상 {freeVideos.length}개
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

        <Block label="Instructor" title="강사 소개">
          <p className="m-0 mb-3 text-[19px] font-semibold tracking-[-0.02em]">{instructor.displayName}</p>
          {instructor.bioMd ? (
            <SimpleMarkdown source={instructor.bioMd} />
          ) : (
            <p className="m-0 text-ink-2">강사 소개를 준비하고 있습니다.</p>
          )}
          <Link href={`/instructors/${instructor.id}`} className="mt-4 inline-flex min-h-11 items-center">
            이 강사의 강의 보기 →
          </Link>
        </Block>

        <Block label="Refund" title="환불 규정 요약">
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-[1.7]">
            <li>· 결제일부터 7일 이내 + 이용 전: 전액</li>
            <li>
              · 진도율 · 지난 기간 중 높은 쪽이 1/3 미만: 결제 금액의 2/3, 1/2 미만: 1/2, 그 이후: 환불 없음
            </li>
            <li>· 수강생 전용 영상을 재생하거나 실습 파일을 받으면 이용한 것으로 봅니다</li>
          </ul>
          <Link href="/policies/refund" className="mt-4 inline-flex min-h-11 items-center">
            환불 정책 전문 →
          </Link>
        </Block>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <PurchaseCard
          course={course}
          access={access}
          offers={offers}
          paymentsOn={paymentsEnabled()}
          loggedIn={!!viewer}
          previewKey={firstPreview?.key ?? null}
        />
      </aside>
    </div>
  );
}
