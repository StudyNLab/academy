// Q&A · 문의 · 공지 입력 검사 (API 가 함께 쓴다)
import { INQUIRY_CATEGORIES, QNA_LIMITS, REPORT_REASONS } from "@aionit/core";
import { z } from "zod";

const title = z
  .string()
  .trim()
  .min(2, { error: "제목을 2자 이상 적어 주세요." })
  .max(QNA_LIMITS.titleMax, { error: `제목은 ${QNA_LIMITS.titleMax}자까지 쓸 수 있습니다.` });
const body = (max: number) =>
  z
    .string()
    .trim()
    .min(2, { error: "내용을 2자 이상 적어 주세요." })
    .max(max, { error: `내용은 ${max.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.` });

export const askInput = z.object({
  courseId: z.uuid(),
  chapterKey: z.string().min(1).max(100),
  sectionId: z.string().max(100).nullish(),
  title,
  body: body(QNA_LIMITS.bodyMax),
  secret: z.boolean().default(false),
  confirmSecret: z.boolean().optional(),
});

export const answerInput = z.object({
  body: body(QNA_LIMITS.bodyMax),
  confirmSecret: z.boolean().optional(),
});

export const reportInput = z.object({
  targetType: z.enum(["question", "answer"]),
  targetId: z.uuid(),
  reason: z.enum(REPORT_REASONS, { error: "신고 사유를 골라 주세요." }),
  detail: z.string().trim().max(500).nullish(),
});

export const moderateInput = z.object({
  targetType: z.enum(["question", "answer"]),
  targetId: z.uuid(),
  hide: z.boolean(),
  reason: z.string().trim().min(2, { error: "사유를 적어 주세요." }).max(300),
});

export const inquiryInput = z.object({
  category: z.enum(INQUIRY_CATEGORIES, { error: "문의 종류를 골라 주세요." }),
  title,
  body: body(QNA_LIMITS.inquiryBodyMax),
});

export const messageInput = z.object({ body: body(QNA_LIMITS.inquiryBodyMax) });

export const noticeInput = z.object({
  title: z.string().trim().min(2, { error: "제목을 적어 주세요." }).max(200),
  bodyMd: z.string().trim().min(1, { error: "내용을 적어 주세요." }).max(20_000),
  pinned: z.boolean().default(false),
  publish: z.boolean(),
});

export const faqInput = z.object({
  category: z.string().trim().min(1, { error: "분류를 적어 주세요." }).max(40),
  question: z.string().trim().min(2, { error: "질문을 적어 주세요." }).max(200),
  answerMd: z.string().trim().min(1, { error: "답을 적어 주세요." }).max(10_000),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  published: z.boolean().default(true),
});
