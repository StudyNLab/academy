import { describe, expect, it } from "vitest";
import type { QnaActor, QuestionLike } from "./qna";
import {
  canAnswer,
  canAsk,
  canPin,
  canReport,
  canResolve,
  isInternalPath,
  isStaleUnanswered,
  nextInquiryState,
  questionView,
  sortAnswers,
} from "./qna";
import { findSecrets } from "./secrets";

const now = new Date("2026-11-05T12:00:00Z");
const learner: QnaActor = { userId: "u-learner", role: "learner", canLearn: true };
const other: QnaActor = { userId: "u-other", role: "learner", canLearn: true };
const outsider: QnaActor = { userId: "u-out", role: "learner", canLearn: false };
const instructor: QnaActor = { userId: "u-inst", role: "instructor", canLearn: true };
const operator: QnaActor = { userId: "u-op", role: "operator", canLearn: true };
const q = (overrides: Partial<QuestionLike> = {}): QuestionLike => ({
  authorId: "u-learner",
  isSecret: false,
  hiddenAt: null,
  deletedAt: null,
  ...overrides,
});

describe("Q&A 권한 (L-06)", () => {
  it("질문은 수강권이 있는 수강생만 쓴다. 강사 · 운영자는 답만 한다", () => {
    expect(canAsk(learner)).toBeNull();
    expect(canAsk(outsider)).toBe("NOT_LEARNER");
    expect(canAsk(instructor)).toBe("STAFF_CANNOT_ASK");
    expect(canAsk(operator)).toBe("STAFF_CANNOT_ASK");
  });

  it("비밀글은 질문자 · 강사 · 운영자만 본다", () => {
    const secret = q({ isSecret: true });
    expect(questionView(secret, learner)).toBe("full");
    expect(questionView(secret, instructor)).toBe("full");
    expect(questionView(secret, operator)).toBe("full");
    expect(questionView(secret, other)).toBe("locked");
    expect(canAnswer(secret, other)).toBe("CANNOT_SEE");
    expect(canAnswer(secret, instructor)).toBeNull();
  });

  it("숨긴 글은 작성자 · 강사 · 운영자만 내용을 보고, 아무도 답을 달 수 없다", () => {
    const hidden = q({ hiddenAt: now });
    expect(questionView(hidden, other)).toBe("hidden");
    expect(questionView(hidden, learner)).toBe("full");
    expect(questionView(hidden, operator)).toBe("full");
    expect(canAnswer(hidden, operator)).toBe("GONE");
    expect(questionView(q({ deletedAt: now }), operator)).toBe("deleted");
  });

  it("수강생끼리 답할 수 있지만 수강권이 없으면 못 단다", () => {
    expect(canAnswer(q(), other)).toBeNull();
    expect(canAnswer(q(), outsider)).toBe("NOT_LEARNER");
  });

  it("해결됨은 질문자 (강사 · 운영자도), 고정은 강사 · 운영자만", () => {
    expect(canResolve(q(), learner)).toBeNull();
    expect(canResolve(q(), other)).toBe("NOT_AUTHOR");
    expect(canResolve(q(), instructor)).toBeNull();
    expect(canPin(learner)).toBe("NOT_STAFF");
    expect(canPin(instructor)).toBeNull();
  });

  it("신고는 볼 수 있는 남의 글만", () => {
    const post = { authorId: "u-learner", deletedAt: null };
    expect(canReport(post, true, other)).toBeNull();
    expect(canReport(post, true, learner)).toBe("OWN_POST");
    expect(canReport(post, false, other)).toBe("CANNOT_SEE");
    expect(canReport(post, true, outsider)).toBe("NOT_LEARNER");
  });

  it("강사 · 운영자 답변이 맨 위, 그다음 오래된 순", () => {
    const at = (m: number) => new Date(now.getTime() + m * 60_000);
    const sorted = sortAnswers([
      { id: "a", authorRole: "learner" as const, createdAt: at(1) },
      { id: "b", authorRole: "instructor" as const, createdAt: at(5) },
      { id: "c", authorRole: "learner" as const, createdAt: at(0) },
      { id: "d", authorRole: "operator" as const, createdAt: at(3) },
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("오래된 미답변: 답변 없이 3일 지난 열린 질문", () => {
    const base = { status: "open", answerCount: 0, hiddenAt: null, deletedAt: null };
    expect(isStaleUnanswered({ ...base, createdAt: new Date(now.getTime() - 3 * 86_400_000) }, now)).toBe(
      true,
    );
    expect(isStaleUnanswered({ ...base, createdAt: new Date(now.getTime() - 2 * 86_400_000) }, now)).toBe(
      false,
    );
    expect(
      isStaleUnanswered(
        { ...base, answerCount: 1, createdAt: new Date(now.getTime() - 9 * 86_400_000) },
        now,
      ),
    ).toBe(false);
    expect(
      isStaleUnanswered(
        { ...base, status: "resolved", createdAt: new Date(now.getTime() - 9 * 86_400_000) },
        now,
      ),
    ).toBe(false);
  });
});

describe("API 키 찾기", () => {
  it("흔한 키 모양을 찾아 가려서 알려 준다", () => {
    const found = findSecrets(
      [
        "client = OpenAI(api_key='sk-proj-AbCdEf0123456789AbCdEf0123456789')",
        "ANTHROPIC_API_KEY=sk-ant-api03-AbCdEf0123456789AbCdEf0123456789",
        "GOOGLE=AIzaSyA1234567890abcdefghijklmnopqrstuv",
        "aws AKIAIOSFODNN7EXAMPLE",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
      ].join("\n"),
    );
    expect(found.map((f) => f.kind)).toEqual([
      "Anthropic API 키",
      "OpenAI API 키",
      "Google API 키",
      "AWS 액세스 키",
      "비밀 키 파일",
    ]);
    // 가린 값에는 키 전체가 들어 있지 않다
    expect(found[1]!.masked).toBe("sk-proj-••••••");
    expect(found[1]!.masked).not.toContain("0123456789");
  });

  it("키 이름만 쓰거나 짧은 예시는 경고하지 않는다", () => {
    expect(findSecrets("OPENAI_API_KEY 를 .env 에 넣었는데 401 이 나요")).toEqual([]);
    expect(findSecrets('api_key="sk-..." 처럼 쓰면 되나요?')).toEqual([]);
    expect(findSecrets("task-management-system-2026 은 어떻게")).toEqual([]);
  });
});

describe("1:1 문의 상태", () => {
  it("회원이 쓰면 기다림, 운영자가 답하면 답변 완료, 닫으면 끝 (닫힌 문의에는 못 쓴다)", () => {
    expect(nextInquiryState("open", "operator_reply")).toBe("answered");
    expect(nextInquiryState("answered", "member_message")).toBe("open");
    expect(nextInquiryState("answered", "close")).toBe("closed");
    expect(nextInquiryState("closed", "member_message")).toBeNull();
    expect(nextInquiryState("closed", "operator_reply")).toBeNull();
  });
});

describe("알림 주소", () => {
  it("우리 사이트 안 경로만", () => {
    expect(isInternalPath("/learn/ai/ch01?qna=1")).toBe(true);
    expect(isInternalPath("/my/inquiries/abc")).toBe(true);
    expect(isInternalPath("//evil.example/x")).toBe(false);
    expect(isInternalPath("https://evil.example")).toBe(false);
    expect(isInternalPath("/\\evil.example")).toBe(false);
  });
});
