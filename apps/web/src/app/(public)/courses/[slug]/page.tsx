import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseCard } from "@/components/commerce/purchase-card";
import { CourseArt } from "@/components/home";
import { SvcIcon } from "@/components/icons";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { youtubeEmbed } from "@/server/content-render";
import { courseDetail, FIELD_LABEL, listCatalog } from "@/server/catalog";
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

// 무료로 볼 수 있는 것 · 수강하면 얻는 것 (서비스 규칙 그대로. 화면상세기획 2.3)
const COMPARE: [string, string, string][] = [
  ["챕터 강의 영상 (유튜브 공개분)", "누구나", "포함"],
  ["수강생 전용 영상", "—", "포함"],
  ["교재 (그림 · 코드 · 실습 안내)", "미리보기 챕터만", "전체 교재"],
  ["실습 파일 · 완성 코드", "—", "포함"],
  ["실습 평가 기준 · 스스로 확인", "—", "포함"],
  ["강의 Q&A (강사 답변)", "—", "포함"],
  ["진도 관리 · 이어서 학습", "—", "포함"],
];

// P-03 강의 상세 (시안 #/course). 글은 모두 과정 · 강사 데이터, 강사 소개는 강사 화면 I-09 에서 쓴 공개 프로필
export default async function CoursePage({ params }: { params: Params }) {
  const db = getDb();
  const detail = await courseDetail(db, (await params).slug);
  if (!detail) notFound();
  const { course, instructor, chapters } = detail;
  const viewer = await getViewer();
  const [access, offers, catalog] = await Promise.all([
    viewAccess(db, viewer, course),
    courseOffers(db, course, viewer),
    listCatalog(db),
  ]);
  const freeVideos = chapters.flatMap((c) => c.videos).filter((v) => v.source === "youtube");
  const labs = chapters.reduce((n, c) => n + c.labs.length, 0);
  const firstFree = freeVideos.find((v) => v.youtubeVideoId);
  const firstPreview = chapters.find((c) => c.preview);
  const no = catalog.findIndex((c) => c.id === course.id) + 1 || 1;
  const sections = [
    { id: "overview", label: "강의 소개", show: Boolean(firstFree?.youtubeVideoId || course.descriptionMd) },
    { id: "curriculum", label: "커리큘럼", show: true },
    { id: "preparation", label: "수강 준비", show: Boolean(course.requirementsMd) },
    { id: "instructor", label: "강사 소개", show: true },
  ].filter((s) => s.show);

  return (
    <>
      <div className="wrap">
        <div className="breadcrumb">
          <Link href="/">홈</Link>
          <span>/</span>
          <Link href="/courses">강의</Link>
          <span>/</span>
          <Link href={`/courses?field=${course.field}`}>{FIELD_LABEL[course.field]}</Link>
        </div>
        <section className="course-hero">
          <div>
            <span className="tag" data-topic={course.field}>
              {FIELD_LABEL[course.field]}
            </span>{" "}
            {course.level ? <span className="tag tag-outline">{course.level}</span> : null}
            <h1>{course.title}</h1>
            {course.summary ? <p>{course.summary}</p> : null}
            <div className="course-meta">
              <span>
                강사 <Link href={`/instructors/${instructor.id}`}>{instructor.displayName}</Link>
              </span>
              <span>{chapters.length}개 챕터</span>
              {labs ? <span>실습 {labs}개</span> : null}
              {freeVideos.length ? <span>무료 공개 영상 {freeVideos.length}개</span> : null}
            </div>
          </div>
          <CourseArt field={course.field} no={no} level={course.level} />
        </section>
      </div>

      <nav className="detail-nav" aria-label="강의 상세 메뉴">
        <div className="wrap">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="wrap detail-layout">
        <div className="detail-content">
          {sections.some((s) => s.id === "overview") ? (
            <section id="overview">
              <div className="eyebrow">ABOUT THIS COURSE</div>
              <h2>강의 소개</h2>
              {firstFree?.youtubeVideoId ? (
                <figure className="m-0 mb-6">
                  <div
                    className="reader max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: youtubeEmbed(firstFree.youtubeVideoId, firstFree.title),
                    }}
                  />
                  <figcaption className="mt-2 text-[13px] text-muted">
                    {firstFree.title} · 무료 공개
                  </figcaption>
                </figure>
              ) : null}
              {course.descriptionMd ? <SimpleMarkdown source={course.descriptionMd} /> : null}
            </section>
          ) : null}

          {course.audienceMd ? (
            <section>
              <div className="eyebrow">FOR YOU</div>
              <h2>이런 분께</h2>
              <SimpleMarkdown source={course.audienceMd} />
            </section>
          ) : null}

          <section id="curriculum">
            <div className="section-heading">
              <div>
                <h2>커리큘럼</h2>
                <p>
                  {chapters.length}개 챕터{labs ? ` · 실습 ${labs}개` : ""}
                  {freeVideos.length ? ` · 무료 공개 영상 ${freeVideos.length}개` : ""}
                </p>
              </div>
            </div>
            <div className="curriculum">
              {chapters.map((chapter, i) => {
                const free = chapter.videos.some((v) => v.source === "youtube");
                return (
                  <details key={chapter.key} open={chapter === firstPreview}>
                    <summary>
                      <span className="chapter-num">{String(i + 1).padStart(2, "0")}</span>
                      <span>{chapter.title}</span>
                      {free || chapter.preview ? (
                        <span className="ml-auto inline-flex gap-2">
                          {free ? <span className="tag">무료 영상</span> : null}
                          {chapter.preview ? (
                            <span className="tag tag-outline">무료 교재 미리보기</span>
                          ) : null}
                        </span>
                      ) : null}
                      <SvcIcon name="chevron" />
                    </summary>
                    <div className="curriculum-body">
                      <ul className="m-0 mb-2 flex flex-col gap-1 p-0">
                        {chapter.videos.map((v) => (
                          <li key={v.key}>
                            {KIND_LABEL[v.kind]} · {v.title} ·{" "}
                            {v.source === "youtube" ? "무료 공개" : "수강생 전용"}
                          </li>
                        ))}
                        {chapter.toc
                          .filter((t) => t.level === 1)
                          .map((t) => (
                            <li key={t.id}>
                              {t.lab ? "실습 · " : ""}
                              {t.title}
                            </li>
                          ))}
                      </ul>
                      {chapter.preview ? (
                        <Link href={`/courses/${course.slug}/preview/${chapter.key}`}>
                          <SvcIcon name="book" /> 무료 미리보기
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <SvcIcon name="lock" /> 수강하면 열립니다
                        </span>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section>
            <h2>무료로 먼저 경험해 보세요.</h2>
            <div className="overflow-x-auto">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>학습 자료</th>
                    <th>무료 공개</th>
                    <th>수강 시</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map(([label, free, paid]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{free}</td>
                      <td>{paid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {course.requirementsMd ? (
            <section id="preparation">
              <h2>시작하기 전에 준비해 주세요.</h2>
              <SimpleMarkdown source={course.requirementsMd} />
            </section>
          ) : null}

          <section id="instructor">
            <h2>강사 소개</h2>
            <div className="instructor">
              <div className="avatar">
                <SvcIcon name="user" />
              </div>
              <div>
                <h3>{instructor.displayName}</h3>
                <p>
                  <Link className="link-line" href={`/instructors/${instructor.id}`}>
                    이 강사의 강의 보기 →
                  </Link>
                </p>
              </div>
            </div>
            <div className="mt-5">
              {instructor.bioMd ? (
                <SimpleMarkdown source={instructor.bioMd} />
              ) : (
                <p>강사 소개를 준비하고 있습니다.</p>
              )}
            </div>
          </section>

          <section>
            <h2>환불 규정 요약</h2>
            <ul className="m-0 flex flex-col gap-2 p-0 text-[14px] leading-[1.8] text-muted">
              <li>· 결제일부터 7일 이내 + 이용 전: 전액</li>
              <li>
                · 진도율 · 지난 기간 중 높은 쪽이 1/3 미만: 결제 금액의 2/3, 1/2 미만: 1/2, 그 이후: 환불 없음
              </li>
              <li>· 수강생 전용 영상을 재생하거나 실습 파일을 받으면 이용한 것으로 봅니다</li>
            </ul>
            <p className="mt-4">
              <Link className="link-line" href="/policies/refund">
                환불 정책 전문
              </Link>
            </p>
          </section>
        </div>

        <aside aria-label="수강 안내" id="purchase">
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
    </>
  );
}
