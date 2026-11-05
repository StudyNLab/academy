import type { Metadata } from "next";
import Link from "next/link";
import { COURSE_FIELDS } from "@aionit/db";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { CatalogCard } from "@/components/catalog-card";
import { SvcIcon } from "@/components/icons";
import { FIELD_LABEL, firstLook, listCatalog } from "@/server/catalog";
import type { CatalogQuery } from "@/server/catalog-filter";
import { CATALOG_SORTS, filterCatalog, parseCatalogQuery } from "@/server/catalog-filter";
import { courseOffers } from "@/server/commerce";
import { getDb } from "@/server/db";
import { paymentsEnabled } from "@/server/payments";

export const metadata: Metadata = { title: "강의" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 조건을 바꾼 목록 주소. 기본값(전체 · 추천순)은 주소에서 뺀다 */
function catalogHref(query: CatalogQuery, change: Partial<CatalogQuery>) {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.field) params.set("field", next.field);
  if (next.q) params.set("q", next.q);
  if (next.instructor) params.set("instructor", next.instructor);
  if (next.sort !== "recommended") params.set("sort", next.sort);
  const text = params.toString();
  return text ? `/courses?${text}` : "/courses";
}

// P-02 강의 목록 (시안 #/courses): 분야 · 검색 · 강사 · 정렬은 모두 실제로 거른다
export default async function CoursesPage({ searchParams }: { searchParams: SearchParams }) {
  const db = getDb();
  const query = parseCatalogQuery(await searchParams);
  const all = await listCatalog(db);
  const courses = filterCatalog(all, query);
  const instructors = [...new Set(all.map((c) => c.instructor))].sort((a, b) => a.localeCompare(b, "ko"));
  const filtered = Boolean(query.field || query.q || query.instructor);

  // 카드의 가격: 비회원이 보는 지금 판매가 (상세 구매 카드와 같은 계산)
  const prices = paymentsEnabled()
    ? await Promise.all(
        courses.map(async (c) => (await courseOffers(db, c, null)).purchase?.quote.paidAmount ?? null),
      )
    : courses.map(() => null);
  // "어디서부터 시작할지" 띠: 목록 첫 강의의 무료 미리보기
  const start = await firstLook(db);

  return (
    <div className="wrap page-main">
      <div className="breadcrumb">
        <Link href="/">홈</Link>
        <span>/</span>
        <span>강의</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">COURSES</span>
          <h1>다음 실력을 만나보세요.</h1>
          <p>기반을 다지고, 시스템을 지키고, AI로 가능성을 넓히는 과정.</p>
        </div>
      </div>

      <div className="catalog-toolbar">
        <nav className="segmented" aria-label="강의 분야">
          {[undefined, ...COURSE_FIELDS].map((field) => (
            <Link
              key={field ?? "all"}
              href={catalogHref(query, { field })}
              className={query.field === field ? "active" : ""}
              aria-current={query.field === field ? "page" : undefined}
            >
              {field ? FIELD_LABEL[field] : "전체"}
            </Link>
          ))}
        </nav>
        <form action="/courses" role="search" className="contents">
          {query.field ? <input type="hidden" name="field" value={query.field} /> : null}
          <div className="inline-search">
            <label className="sr-only" htmlFor="course-search">
              강의 검색
            </label>
            <input
              className="field"
              id="course-search"
              name="q"
              type="search"
              placeholder="어떤 기술을 배우고 싶으세요?"
              defaultValue={query.q ?? ""}
              maxLength={100}
            />
            <button className="icon-btn" aria-label="검색하기">
              <SvcIcon name="search" />
            </button>
          </div>
          <label className="select-label">
            강사
            <AutoSubmitSelect name="instructor" defaultValue={query.instructor ?? ""}>
              <option value="">전체 강사</option>
              {instructors.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </AutoSubmitSelect>
          </label>
          <label className="select-label">
            정렬
            <AutoSubmitSelect name="sort" defaultValue={query.sort}>
              {Object.entries(CATALOG_SORTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AutoSubmitSelect>
          </label>
        </form>
      </div>

      <p className="results-count" aria-live="polite">
        {courses.length}개의 과정
        {filtered ? (
          <span>
            {" "}
            ·{" "}
            <Link href={catalogHref(query, { field: undefined, q: undefined, instructor: undefined })}>
              조건 지우기
            </Link>
          </span>
        ) : null}
      </p>
      {courses.length > 0 ? (
        <div className="catalog-grid">
          {courses.map((course, i) => (
            <CatalogCard
              key={course.id}
              course={course}
              no={all.indexOf(course) + 1}
              price={prices[i] ?? null}
            />
          ))}
        </div>
      ) : (
        <p className="border-t border-line py-10 text-muted">
          {all.length === 0 ? "곧 첫 강의가 열립니다." : "조건에 맞는 강의가 없습니다."}
        </p>
      )}

      {start ? (
        <div className="wide-callout">
          <div>
            <h2>어디서부터 시작할지 고민되나요?</h2>
            <p>무료로 열어 둔 챕터를 먼저 읽어 보고 정하세요.</p>
          </div>
          <Link className="btn secondary" href={start.href}>
            {start.preview ? "무료 교재 읽어 보기" : "강의 살펴보기"}
            <SvcIcon name="arrow" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
