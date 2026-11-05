import type { Metadata } from "next";
import Link from "next/link";
import { COVER } from "@/components/catalog-card";
import { SvcIcon } from "@/components/icons";
import { FIELD_LABEL } from "@/server/catalog";
import { getDb } from "@/server/db";
import type { ClassroomItem } from "@/server/learning";
import { myClassroom } from "@/server/learning";
import { requireViewer } from "@/server/session";

export const metadata: Metadata = { title: "내 강의실" };

const day = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });

/** 수강 기간 글: 끝남 · n일 남음 · ~까지 · 제한 없음 */
function period(item: ClassroomItem) {
  const last = item.endsAt ? day.format(new Date(item.endsAt.getTime() - 1)) : null;
  if (!item.active) return last ? `${last} 수강 끝남` : "수강 끝남";
  if (item.daysLeft !== null && item.daysLeft <= 30) return `${item.daysLeft}일 남음 · ${last}까지`;
  return last ? `${last}까지` : "기간 제한 없음";
}

function CourseCard({ item, no }: { item: ClassroomItem; no: number }) {
  const cover = COVER[item.field];
  const soon = item.active && item.daysLeft !== null && item.daysLeft <= 30;
  return (
    <article className="classroom-course">
      <div className={`catalog-art ${cover.art}`} data-topic={item.field} aria-hidden="true">
        <span>AIONIT / {FIELD_LABEL[item.field]}</span>
        <div className="cover-glyph">{cover.glyph}</div>
        <small>ENGINEERING SERIES / {String(no).padStart(2, "0")}</small>
      </div>
      <div>
        <div className="row between">
          <span className={`tag ${soon ? "warm" : ""}`}>
            {!item.active ? "수강 끝남" : item.lastStudiedAt ? "학습 중" : "시작 전"}
          </span>
          <span className="muted">{period(item)}</span>
        </div>
        <h2>
          <Link href={`/courses/${item.slug}`}>{item.title}</Link>
        </h2>
        <p>
          {item.resume ? `다음 학습 · ${item.resume.title}` : `강사 ${item.instructor}`}
          {item.lastStudiedAt ? ` · 마지막 학습 ${day.format(item.lastStudiedAt)}` : ""}
        </p>
        <div className="progress-caption">
          <span>학습 진도</span>
          <strong>
            {item.percent}%{" "}
            <small>
              {item.doneChapters} / {item.chapterCount} 챕터
            </small>
          </strong>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label={`${item.title} 진도`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.percent}
        >
          <span style={{ width: `${item.percent}%` }} />
        </div>
        <div className="row gap16 classroom-actions">
          {item.active && item.resume ? (
            <Link
              className={item.lastStudiedAt ? "btn primary" : "btn secondary"}
              href={`/learn/${item.slug}/${item.resume.key}`}
            >
              {item.lastStudiedAt ? "이어서 학습" : "학습 시작"} <SvcIcon name="arrow" />
            </Link>
          ) : (
            <Link className="btn secondary" href={`/learn/${item.slug}`}>
              수강 연장 안내 <SvcIcon name="arrow" />
            </Link>
          )}
          <Link className="link-line" href={`/courses/${item.slug}`}>
            강의 안내
          </Link>
        </div>
      </div>
    </article>
  );
}

// L-01 내 강의실 (시안 #/classroom): 수강 중 · 끝난 강의, 진도율, 이어서 학습, 만료 임박 표시
export default async function ClassroomPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await requireViewer("/learn");
  const items = await myClassroom(getDb(), viewer.userId);
  const ended = (await searchParams).tab === "ended";
  const shown = items.filter((item) => item.active !== ended);
  const studying = items.filter((item) => item.active).length;
  const doneChapters = items.reduce((n, item) => n + item.doneChapters, 0);
  return (
    <div className="wrap page-main">
      <div className="breadcrumb">
        <Link href="/">홈</Link>
        <span>/</span>
        <span>내 강의실</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MY CLASSROOM</span>
          <h1>오늘도, 한 걸음 더.</h1>
          <p>배우던 곳에서 이어서 시작하세요.</p>
        </div>
      </div>
      <div className="classroom-summary">
        <div>
          <span className="eyebrow">KEEP BUILDING</span>
          <h2>{viewer.nickname}님의 학습 공간</h2>
          <p>작은 실행이 쌓여, 문제를 푸는 실력이 됩니다.</p>
        </div>
        <div className="summary-numbers">
          <div>
            <strong>{studying}</strong>
            <span>학습 중</span>
          </div>
          <div>
            <strong>{doneChapters}</strong>
            <span>완료한 챕터</span>
          </div>
        </div>
      </div>
      <nav className="page-tabs" aria-label="내 강의실 보기">
        <Link className={ended ? "" : "active"} href="/learn" aria-current={ended ? undefined : "page"}>
          수강 중
        </Link>
        <Link
          className={ended ? "active" : ""}
          href="/learn?tab=ended"
          aria-current={ended ? "page" : undefined}
        >
          끝난 강의
        </Link>
        <Link href="/my/entitlements">
          수강권 관리 <SvcIcon name="arrow" />
        </Link>
      </nav>
      {shown.length === 0 ? (
        <div className="empty-state">
          <SvcIcon name="book" />
          <h2>{ended ? "끝난 강의가 없습니다." : "첫 번째 배움을 시작해 보세요."}</h2>
          <p>
            {ended
              ? "수강 기간이 끝난 강의가 여기에 모입니다."
              : "아직 수강 중인 강의가 없습니다. 무료 교재부터 살펴볼 수 있습니다."}
          </p>
          {ended ? null : (
            <Link className="btn secondary" href="/courses">
              강의 둘러보기 <SvcIcon name="arrow" />
            </Link>
          )}
        </div>
      ) : (
        shown.map((item, i) => <CourseCard key={item.id} item={item} no={i + 1} />)
      )}
      <div className="notice">
        <strong>실습 체크는 바로 저장됩니다.</strong>
        영상 · 교재 · 실습을 함께 마치면 한 챕터가 완료됩니다. 시험이나 퀴즈는 없습니다.
      </div>
    </div>
  );
}
