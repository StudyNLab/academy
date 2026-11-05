import Link from "next/link";
import type { CourseField } from "@aionit/db";
import { subscriptionPlans } from "@aionit/payments";
import { won } from "@/components/commerce/format";
import { CourseArt, FIELD_EN, HeroArt, MethodSection } from "@/components/home";
import { SvcIcon } from "@/components/icons";
import { courseDetail, FIELD_LABEL, listCatalog } from "@/server/catalog";
import { getDb } from "@/server/db";

// P-01 홈 — 시안 AIONIT-Service 홈 (app.js home + screens.js 구독 안내 띠).
// 강의 · 미리보기 · 구독 요금은 실제 데이터. 시안의 예시 강의("준비 중" 목록) · 예시 요금은 쓰지 않는다.
const fields: { key: CourseField; no: string; tagline: string }[] = [
  { key: "infra", no: "01 /", tagline: "BUILD THE FOUNDATION" },
  { key: "security", no: "02 /", tagline: "PROTECT WHAT MATTERS" },
  { key: "ai", no: "03 /", tagline: "EXPAND WHAT'S POSSIBLE" },
];

const miniCover: Record<CourseField, string> = { infra: ">_", security: "{ }", ai: "AI" };

export default async function HomePage() {
  const db = getDb();
  const [catalog, plans] = await Promise.all([listCatalog(db), subscriptionPlans(db)]);
  const featured = catalog[0] ?? null;
  const others = catalog.slice(1, 4);
  const detail = featured ? await courseDetail(db, featured.slug) : null;
  const previewKey = detail?.chapters.find((c) => c.preview)?.key ?? null;
  const previewHref = featured && previewKey ? `/courses/${featured.slug}/preview/${previewKey}` : null;
  const aiCourse = catalog.find((c) => c.field === "ai");
  const monthly = plans.find((p) => p.product.billingInterval === "month");

  return (
    <div className="is-home">
      <section className="launch-zone">
        <div className="wrap">
          <section className="hero">
            <div>
              <div className="hero-kicker">BUILD YOUR NEXT. / AIONIT</div>
              <h1>
                기술을 이해하고,
                <br />
                <em>가능성을 실행하다.</em>
              </h1>
              <p className="hero-desc">
                인프라부터 보안, AI 에이전트까지.
                <br />
                코드를 실행하고, 시스템을 연결하고,
                <br />
                현업의 문제를 직접 해결하는 실력을 만듭니다.
              </p>
              <div className="hero-actions">
                <Link
                  className="btn primary"
                  href={aiCourse ? `/courses/${aiCourse.slug}` : "/courses?field=ai"}
                >
                  AI Agent 만들기 <SvcIcon name="arrow" />
                </Link>
                <Link className="btn secondary" href={previewHref ?? "/courses"}>
                  교재 미리보기 <SvcIcon name="book" />
                </Link>
              </div>
              <div className="hero-foot">
                <span className="line" />
                <span>영상으로 이해하고 · 교재로 정리하고 · 실습으로 완성합니다</span>
              </div>
            </div>
            <HeroArt />
          </section>
        </div>
      </section>

      <div className="wrap">
        <div className="discipline-strip">
          <div className="strip-intro">
            기술은 연결되어 있습니다.
            <br />
            배움도 연결되어야 하니까.
          </div>
          {fields.map((f) => (
            <Link key={f.key} className="discipline" data-topic={f.key} href={`/courses?field=${f.key}`}>
              <span>{f.no}</span>
              <div>
                <h3>{FIELD_LABEL[f.key]}</h3>
                <small>{f.tagline}</small>
              </div>
            </Link>
          ))}
        </div>

        <section className="section" id="courses">
          <div className="section-heading">
            <div>
              <div className="eyebrow">BUILD SOMETHING REAL</div>
              <h2>첫 번째 배움을 시작하세요.</h2>
            </div>
            {catalog.length > 0 ? (
              <span className="tag tag-outline">공개 강의 {catalog.length}개</span>
            ) : null}
          </div>

          {featured ? (
            <article className="feature-course">
              <CourseArt field={featured.field} no={1} level={featured.level} />
              <div className="course-copy">
                <div>
                  <span className="tag" data-topic={featured.field}>
                    {FIELD_LABEL[featured.field]}
                  </span>{" "}
                  {featured.level ? <span className="tag tag-outline">{featured.level}</span> : null}
                </div>
                <h3>{featured.title}</h3>
                {featured.summary ? <p>{featured.summary}</p> : null}
                <div className="course-meta">
                  <span>{featured.chapters}개 챕터</span>
                  <span>실습 {featured.labs}개</span>
                  <span>{featured.inSubscription ? "구독 포함" : "프리미엄"}</span>
                  <span>강사 {featured.instructor}</span>
                </div>
                <div className="course-bottom">
                  <span>{previewKey ? "무료 미리보기 제공" : "교재 + 영상 + 실습"}</span>
                  <Link className="btn primary small" href={`/courses/${featured.slug}`}>
                    강의 살펴보기 <SvcIcon name="arrow" />
                  </Link>
                </div>
              </div>
            </article>
          ) : (
            <p className="muted">곧 첫 강의가 열립니다.</p>
          )}

          {others.length > 0 ? (
            <div className="upcoming">
              {others.map((course) => (
                <article key={course.id}>
                  <div className="mini-cover" data-topic={course.field} aria-hidden="true">
                    {miniCover[course.field]}
                  </div>
                  <div>
                    <h3>
                      <Link href={`/courses/${course.slug}`}>{course.title}</Link>
                    </h3>
                    <p>
                      {FIELD_EN[course.field].long} · {course.chapters}개 챕터
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <MethodSection />

      <div className="wrap">
        <section className="wide-callout home-membership">
          <div>
            <span className="eyebrow">KEEP LEARNING</span>
            <h2>하나의 구독으로, 연결되는 배움.</h2>
            <p>구독 포함 강의를 기간 동안 자유롭게. 단건 구매와 구독 중 나에게 맞는 방식을 선택하세요.</p>
            {monthly ? <small className="muted">월간 구독 월 {won(monthly.price.amount)}</small> : null}
          </div>
          <Link className="btn secondary" href="/subscribe">
            구독 안내 보기
            <SvcIcon name="arrow" />
          </Link>
        </section>
        <section className="closing">
          <div>
            <div className="eyebrow">START WITH ONE CHAPTER</div>
            <h2>읽어 보면, 배움의 차이가 보입니다.</h2>
          </div>
          {previewHref ? (
            <Link className="btn primary" href={previewHref}>
              로그인 없이 교재 읽어 보기 <SvcIcon name="arrow" />
            </Link>
          ) : (
            <Link className="btn primary" href="/courses">
              강의 둘러보기 <SvcIcon name="arrow" />
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}
