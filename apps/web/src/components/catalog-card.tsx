// P-02 강의 카드 (시안 .catalog-card). 표지는 분야별 글자 그림 — 시안은 강의마다 따로 그렸다 (강의별 표지는 아직 없는 기능)
import Link from "next/link";
import type { CourseField } from "@aionit/db";
import { won } from "@/components/commerce/format";
import { SvcIcon } from "@/components/icons";
import type { CatalogItem } from "@/server/catalog";
import { FIELD_LABEL } from "@/server/catalog";

const COVER: Record<CourseField, { art: string; glyph: string }> = {
  ai: { art: "agent", glyph: "agent.run()" },
  infra: { art: "linux", glyph: ">_" },
  security: { art: "security", glyph: "[ / ]" },
};

/** price: 비회원 기준 지금 판매가 (단건 판매가 없으면 null) */
export function CatalogCard({
  course,
  no,
  price,
}: {
  course: CatalogItem;
  no: number;
  price: number | null;
}) {
  const href = `/courses/${course.slug}`;
  const cover = COVER[course.field];
  return (
    <article className="catalog-card" data-topic={course.field}>
      <div className={`catalog-art ${cover.art}`} data-topic={course.field} aria-hidden="true">
        <span>AIONIT / {FIELD_LABEL[course.field]}</span>
        <div className="cover-glyph">{cover.glyph}</div>
        <small>ENGINEERING SERIES / {String(no).padStart(2, "0")}</small>
      </div>
      <div className="catalog-copy">
        <div className="row gap8">
          <span className="tag" data-topic={course.field}>
            {FIELD_LABEL[course.field]}
          </span>
          <span className="tag tag-outline">{course.inSubscription ? "단건 · 구독 포함" : "프리미엄"}</span>
        </div>
        <h2>
          <Link href={href}>{course.title}</Link>
        </h2>
        {course.summary ? <p>{course.summary}</p> : null}
        <div className="card-meta">
          {course.level ? `${course.level} · ` : ""}
          {course.chapters}개 챕터{course.labs ? ` · 실습 ${course.labs}개` : ""} <span>·</span>{" "}
          {course.instructor}
        </div>
        <div className="card-bottom">
          {price !== null ? (
            <strong>
              {won(price)} <small>VAT 포함{course.inSubscription ? " · 구독하면 추가 결제 없음" : ""}</small>
            </strong>
          ) : (
            <span className="muted">
              {course.freeVideos
                ? `무료 공개 영상 ${course.freeVideos}개`
                : course.inSubscription
                  ? "구독 포함"
                  : ""}
            </span>
          )}
          <Link className="link-line" href={href}>
            강의 보기 <SvcIcon name="arrow" />
          </Link>
        </div>
      </div>
    </article>
  );
}
