import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogCard } from "@/components/catalog-card";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { FIELD_LABEL, listCatalog } from "@/server/catalog";
import { getDb } from "@/server/db";
import { publicInstructor } from "@/server/instructors";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  return UUID.test(id) ? publicInstructor(getDb(), id) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load((await params).id);
  return { title: data ? `${data.instructor.displayName} 강사` : "강사 소개" };
}

// P-06 강사 소개 (시안 #/instructor-profile): 공개 프로필(이름 · 소개)과 공개 중인 강의. 공개 강의가 없는 강사는 보이지 않는다
export default async function InstructorPublicPage({ params }: { params: Params }) {
  const data = await load((await params).id);
  if (!data) notFound();
  const { instructor, courses } = data;
  const slugs = new Set(courses.map((c) => c.slug));
  const catalog = (await listCatalog(getDb())).filter((c) => slugs.has(c.slug));
  const fields = [...new Set(courses.map((c) => c.field))];
  return (
    <div className="wrap page-main">
      <div className="breadcrumb">
        <Link href="/">홈</Link>
        <span>/</span>
        <Link href="/courses">강의</Link>
        <span>/</span>
        <span>강사 소개</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PEOPLE WHO BUILD</span>
          <h1>{instructor.displayName}</h1>
          <p>실무의 문제를 교재와 실행 가능한 실습으로 풀어갑니다.</p>
        </div>
      </div>
      <section className="instructor-profile surface">
        <div className="instructor-portrait" aria-hidden="true">
          {instructor.displayName.slice(0, 1)}
        </div>
        <div>
          <span className="eyebrow">AIONIT INSTRUCTOR</span>
          <h2>강사 소개</h2>
          <div className="row gap8">
            {fields.map((f) => (
              <span key={f} className="tag" data-topic={f}>
                {FIELD_LABEL[f]}
              </span>
            ))}
          </div>
          {instructor.bioMd ? (
            <SimpleMarkdown source={instructor.bioMd} />
          ) : (
            <p className="text-muted">강사 소개를 준비하고 있습니다.</p>
          )}
        </div>
      </section>
      <section className="page-section">
        <h2>이 강사의 강의</h2>
        <div className="catalog-grid">
          {catalog.map((course, n) => (
            <CatalogCard key={course.id} course={course} no={n + 1} price={null} />
          ))}
        </div>
      </section>
    </div>
  );
}
