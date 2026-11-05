import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonoLabel } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { FIELD_LABEL } from "@/server/catalog";
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

// P-06 강사 소개: 공개 프로필(이름 · 소개)과 공개 중인 강의. 공개 강의가 없는 강사는 보이지 않는다
export default async function InstructorPublicPage({ params }: { params: Params }) {
  const data = await load((await params).id);
  if (!data) notFound();
  const { instructor, courses } = data;
  return (
    <div className="mx-auto max-w-[960px] px-5 pt-16 pb-24 md:px-14">
      <PageTitle label="Instructor" title={instructor.displayName} />
      {instructor.bioMd ? (
        <div className="max-w-[760px]">
          <SimpleMarkdown source={instructor.bioMd} />
        </div>
      ) : null}
      <section className="mt-14 border-t border-line-strong pt-6">
        <MonoLabel className="text-xs text-signal">Courses</MonoLabel>
        <h2 className="mt-2 mb-5 text-[26px] font-semibold tracking-[-0.025em]">강의</h2>
        <ul className="m-0 flex list-none flex-col p-0">
          {courses.map((c) => (
            <li key={c.slug} className="border-b border-line py-4">
              <Link href={`/courses/${c.slug}`} className="text-[19px] font-semibold tracking-[-0.02em]">
                {c.title}
              </Link>
              <p className="m-0 mt-1 text-[14px] text-ink-2">
                {FIELD_LABEL[c.field]}
                {c.level ? ` · ${c.level}` : ""}
                {c.summary ? ` · ${c.summary}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
