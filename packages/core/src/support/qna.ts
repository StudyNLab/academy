// 강의 Q&A (L-06) · 1:1 문의 (M-05) 업무 규칙. DB 를 모르는 순수 함수로 두고 web 이 부른다.

export type QnaRole = "instructor" | "learner" | "operator";

/** 이 과정 Q&A 에서 이 사람의 자리. 운영자가 먼저 (운영자이면서 강사여도 운영자로 답한다) */
export interface QnaActor {
  userId: string;
  role: QnaRole;
  /** 수강권이 있는 수강생 또는 운영자 · 그 과정 강사 */
  canLearn: boolean;
}

export const isStaffRole = (role: QnaRole) => role !== "learner";

export interface QuestionLike {
  authorId: string;
  isSecret: boolean;
  hiddenAt: Date | null;
  deletedAt: Date | null;
}

/**
 * 질문을 어떻게 보여 주나.
 *   full: 제목 · 내용 · 답변 모두
 *   locked: 비밀글. 목록에 "🔒 비밀글입니다" 만 (질문자 · 그 과정 강사 · 운영자가 아니면)
 *   hidden: 운영자가 숨김. 작성자 · 운영자 · 강사가 아니면 "운영자가 숨긴 글입니다"
 *   deleted: 작성자가 지움
 */
export type QuestionView = "full" | "locked" | "hidden" | "deleted";

export function questionView(question: QuestionLike, actor: QnaActor): QuestionView {
  if (question.deletedAt) return "deleted";
  const mine = question.authorId === actor.userId;
  if (question.hiddenAt && !mine && !isStaffRole(actor.role)) return "hidden";
  if (question.isSecret && !mine && !isStaffRole(actor.role)) return "locked";
  return "full";
}

export type QnaDenied =
  "NOT_LEARNER" | "STAFF_CANNOT_ASK" | "CANNOT_SEE" | "NOT_AUTHOR" | "NOT_STAFF" | "OWN_POST" | "GONE";

/** 질문 쓰기: 수강권이 있는 수강생만 (완료 기준). 운영자 · 강사는 답만 한다 */
export function canAsk(actor: QnaActor): QnaDenied | null {
  if (actor.role !== "learner") return "STAFF_CANNOT_ASK";
  if (!actor.canLearn) return "NOT_LEARNER";
  return null;
}

/** 답변 쓰기: 볼 수 있는 질문에 수강생끼리 · 강사 · 운영자. 숨긴 · 지운 질문에는 못 단다 */
export function canAnswer(question: QuestionLike, actor: QnaActor): QnaDenied | null {
  if (!actor.canLearn) return "NOT_LEARNER";
  if (question.deletedAt || question.hiddenAt) return "GONE";
  if (questionView(question, actor) !== "full") return "CANNOT_SEE";
  return null;
}

/** [해결됨] · [다시 열기]: 질문자 (강사 · 운영자도 정리할 수 있다) */
export function canResolve(question: QuestionLike, actor: QnaActor): QnaDenied | null {
  if (!actor.canLearn) return "NOT_LEARNER";
  if (question.deletedAt) return "GONE";
  if (question.authorId !== actor.userId && !isStaffRole(actor.role)) return "NOT_AUTHOR";
  return null;
}

/** 위에 고정: 그 과정 강사 · 운영자 */
export function canPin(actor: QnaActor): QnaDenied | null {
  return isStaffRole(actor.role) && actor.canLearn ? null : "NOT_STAFF";
}

/** 신고: 볼 수 있는 남의 글 */
export function canReport(
  target: { authorId: string; deletedAt: Date | null },
  visible: boolean,
  actor: QnaActor,
): QnaDenied | null {
  if (!actor.canLearn) return "NOT_LEARNER";
  if (target.deletedAt) return "GONE";
  if (!visible) return "CANNOT_SEE";
  if (target.authorId === actor.userId) return "OWN_POST";
  return null;
}

export const REPORT_REASONS = [
  "스팸 · 광고",
  "욕설 · 비방",
  "개인정보 · 비밀 키 노출",
  "강의 내용 무단 공개",
  "기타",
] as const;

/** 답변 순서: 강사 · 운영자 답변이 맨 위, 그다음 오래된 순 */
export function sortAnswers<T extends { authorRole: QnaRole; createdAt: Date }>(answers: T[]): T[] {
  return [...answers].sort((a, b) => {
    const staff = Number(isStaffRole(b.authorRole)) - Number(isStaffRole(a.authorRole));
    return staff !== 0 ? staff : a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/** 운영자 화면(AD-17) "오래된 미답변": 답변 없이 이만큼 지난 열린 질문 */
export const STALE_UNANSWERED_MS = 3 * 86_400_000;

export function isStaleUnanswered(
  question: {
    status: string;
    answerCount: number;
    createdAt: Date;
    hiddenAt: Date | null;
    deletedAt: Date | null;
  },
  now: Date,
): boolean {
  return (
    question.status === "open" &&
    question.answerCount === 0 &&
    !question.hiddenAt &&
    !question.deletedAt &&
    now.getTime() - question.createdAt.getTime() >= STALE_UNANSWERED_MS
  );
}

/** 글을 너무 많이 올리지 못하게 (한 시간에) */
export const POSTING_LIMITS = { questionsPerHour: 10, answersPerHour: 30, inquiriesPerDay: 10 } as const;

/** 글 길이 */
export const QNA_LIMITS = { titleMax: 120, bodyMax: 10_000, inquiryBodyMax: 5_000 } as const;

// ---- 1:1 문의 ----

export const INQUIRY_CATEGORIES = [
  "결제 · 환불",
  "구독",
  "수강 · 학습",
  "계정 · 로그인",
  "강의 내용",
  "기타",
] as const;

export type InquiryState = "open" | "answered" | "closed";
export type InquiryEvent = "member_message" | "operator_reply" | "close";

/**
 * 문의 상태: 회원이 쓰면 open(답변 기다림), 운영자가 답하면 answered, 닫으면 closed.
 * 닫힌 문의에는 더 쓸 수 없다 (새 문의로). null = 할 수 없는 일
 */
export function nextInquiryState(current: InquiryState, event: InquiryEvent): InquiryState | null {
  if (current === "closed") return null;
  if (event === "close") return "closed";
  return event === "operator_reply" ? "answered" : "open";
}

/** 알림 · 메일에 넣을 주소: 우리 사이트 안 경로만 (바깥 주소로 보내는 알림을 만들 수 없게) */
export function isInternalPath(url: string): boolean {
  return /^\/(?!\/)[^\s\\]*$/.test(url);
}
