import type { InstructorCourseState } from "@aionit/core";

// 강사 화면에서 쓰는 표시 이름 (상태는 점 + 글)
export const COURSE_STATE: Record<
  InstructorCourseState,
  { tone: "done" | "warn" | "danger" | "muted"; label: string }
> = {
  draft: { tone: "muted", label: "작성 중" },
  in_review: { tone: "warn", label: "검수 대기" },
  published: { tone: "done", label: "공개" },
  rejected: { tone: "danger", label: "반려" },
  hidden: { tone: "warn", label: "목록에서 숨김" },
};

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export const kstDay = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });
