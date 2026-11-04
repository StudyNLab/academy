import { COURSE_FIELDS } from "@aionit/db";
import { z } from "zod";

// 과정 등록 · 수정 입력 (AD-02)
const courseFields = {
  title: z.string().trim().min(2).max(120),
  field: z.enum(COURSE_FIELDS),
  level: z.string().trim().max(20).default(""),
  ownerInstructorId: z.uuid(),
  summary: z.string().trim().max(300).default(""),
  descriptionMd: z.string().max(20_000).default(""),
  audienceMd: z.string().max(5_000).default(""),
  requirementsMd: z.string().max(5_000).default(""),
  inSubscription: z.boolean(),
};

export const createCourseSchema = z.object({
  slug: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      error: "과정 ID 는 영문 소문자 · 숫자 · - 만 (패키지의 course_id 와 같게)",
    }),
  ...courseFields,
});

export const updateCourseSchema = z.object(courseFields);
