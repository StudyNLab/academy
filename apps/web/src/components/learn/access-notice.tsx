// L-05 수강 만료 / 권한 없음 안내. 연장권(M5) · 구독(M6)이 생기면 그 안내로 잇는다
import Link from "next/link";
import { buttonClass, MonoLabel } from "@aionit/ui";

const day = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" });

export function AccessNotice({
  course,
  reason,
  lastEndedAt,
  previewKey,
}: {
  course: { slug: string; title: string; inSubscription: boolean };
  reason: "none" | "expired" | "not_started";
  lastEndedAt?: Date;
  previewKey?: string | null;
}) {
  const title =
    reason === "expired"
      ? "수강 기간이 끝났습니다"
      : reason === "not_started"
        ? "아직 수강을 시작할 수 없습니다"
        : "이 강의의 수강권이 없습니다";
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-5 pt-16 md:pt-24">
      <MonoLabel className="text-xs text-signal">{course.title}</MonoLabel>
      <h1 className="m-0 text-[32px] leading-[1.2] font-semibold tracking-[-0.035em] md:text-[40px]">
        {title}
      </h1>
      <p className="m-0 text-[17px] leading-[1.8] text-ink-2">
        {reason === "expired" && lastEndedAt
          ? `${day.format(new Date(lastEndedAt.getTime() - 1))}에 수강 기간이 끝났습니다. 지금까지의 진도와 실습 체크는 그대로 남아 있어, 다시 수강하면 이어서 볼 수 있습니다.`
          : reason === "not_started"
            ? "수강 시작일이 되면 이 화면에서 바로 볼 수 있습니다."
            : "강의를 구매하거나 구독하면 교재 전체 · 실습 파일 · 스스로 확인 · 강의 Q&A 가 열립니다."}
      </p>
      <p className="m-0 text-[15px] text-ink-2">
        {course.inSubscription
          ? "이 강의는 구독에 포함됩니다. 구매 · 구독 · 연장은 곧 열립니다."
          : "프리미엄 강의입니다. 구매 · 연장은 곧 열립니다."}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-line-strong pt-6">
        <Link href={`/courses/${course.slug}`} className={buttonClass("primary", "md")}>
          강의 안내 보기
        </Link>
        {previewKey ? (
          <Link
            href={`/courses/${course.slug}/preview/${previewKey}`}
            className={buttonClass("outline", "md")}
          >
            무료 미리보기
          </Link>
        ) : null}
        <Link href="/learn" className="inline-flex min-h-11 items-center">
          내 강의실 →
        </Link>
      </div>
    </div>
  );
}
