import type { VersionStatus } from "@aionit/db";

// 교재 버전 상태 표시 (점 + 글)
export const VERSION_STATUS: Record<
  VersionStatus,
  { tone: "done" | "warn" | "danger" | "muted"; label: string }
> = {
  uploaded: { tone: "muted", label: "올림 · 처리 대기" },
  processing: { tone: "muted", label: "검사 중" },
  invalid: { tone: "danger", label: "검사 실패" },
  ready: { tone: "warn", label: "검수 대기" },
  in_review: { tone: "warn", label: "검수 요청" },
  rejected: { tone: "danger", label: "반려" },
  published: { tone: "done", label: "공개 중" },
  archived: { tone: "muted", label: "지난 공개본" },
};
