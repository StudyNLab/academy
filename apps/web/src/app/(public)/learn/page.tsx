import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, MonoLabel, ProgressBar, StatusDot } from "@aionit/ui";
import { PageTitle } from "@/components/page-title";
import { getDb } from "@/server/db";
import { myClassroom } from "@/server/learning";
import { requireViewer } from "@/server/session";

export const metadata: Metadata = { title: "내 강의실" };

const day = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });

// L-01 내 강의실: 수강 중인 강의, 진도율, 이어서 학습, 만료 임박 표시
export default async function ClassroomPage() {
  const viewer = await requireViewer("/learn");
  const items = await myClassroom(getDb(), viewer.userId);
  return (
    <div className="mx-auto max-w-[1296px] px-5 pt-12 md:px-14 md:pt-16">
      <PageTitle label="Classroom" title="내 강의실" />
      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-4 border-t border-line-strong pt-6">
          <p className="m-0 text-[17px]">아직 수강 중인 강의가 없습니다.</p>
          <Link href="/courses" className={buttonClass("primary", "md")}>
            강의 둘러보기
          </Link>
        </div>
      ) : (
        <ol className="m-0 list-none border-t border-line-strong p-0">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="grid gap-4 border-b border-line py-6 md:grid-cols-[48px_1fr_240px_200px] md:items-center"
            >
              <MonoLabel className="text-xs text-ink-2">{String(index + 1).padStart(2, "0")}</MonoLabel>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Link
                  href={`/courses/${item.slug}`}
                  className="text-[19px] font-semibold text-ink no-underline"
                >
                  {item.title}
                </Link>
                <span className="text-[14px] text-ink-2">
                  강사 {item.instructor} · {item.chapterCount} CHAPTER
                  {item.lastStudiedAt
                    ? ` · 마지막 학습 ${day.format(item.lastStudiedAt)}`
                    : " · 아직 시작 전"}
                </span>
                <span>
                  {!item.active ? (
                    <StatusDot tone="muted">
                      {item.endsAt
                        ? `${day.format(new Date(item.endsAt.getTime() - 1))} 수강 끝남`
                        : "수강 끝남"}
                    </StatusDot>
                  ) : item.daysLeft !== null && item.daysLeft <= 30 ? (
                    <StatusDot tone="warn">
                      {item.daysLeft}일 남음 · {day.format(new Date(item.endsAt!.getTime() - 1))}까지
                    </StatusDot>
                  ) : (
                    <StatusDot tone="done">
                      {item.endsAt
                        ? `${day.format(new Date(item.endsAt.getTime() - 1))}까지`
                        : "기간 제한 없음"}
                    </StatusDot>
                  )}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[14px] tabular-nums">진도 {item.percent}%</span>
                <ProgressBar value={item.percent} label={`${item.title} 진도`} />
              </div>
              {item.active && item.resume ? (
                <Link
                  href={`/learn/${item.slug}/${item.resume.key}`}
                  className={buttonClass(
                    item.lastStudiedAt ? "primary" : "outline",
                    "md",
                    "justify-self-start md:justify-self-end",
                  )}
                >
                  {item.lastStudiedAt ? "이어서 학습" : "학습 시작"}
                </Link>
              ) : (
                <Link
                  href={`/learn/${item.slug}`}
                  className={buttonClass("outline", "md", "justify-self-start md:justify-self-end")}
                >
                  수강 연장 안내
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
