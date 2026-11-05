import { COURSE_FIELDS } from "@aionit/db";
import { z } from "zod";

// 과정 등록 · 수정 입력 (AD-02 운영자 · I-02 강사)
const basicFields = {
  title: z.string().trim().min(2).max(120),
  field: z.enum(COURSE_FIELDS),
  level: z.string().trim().max(20).default(""),
  summary: z.string().trim().max(300).default(""),
  descriptionMd: z.string().max(20_000).default(""),
  audienceMd: z.string().max(5_000).default(""),
  requirementsMd: z.string().max(5_000).default(""),
};

/** 운영자만 정하는 것: 강사 · 구독 포함 */
const courseFields = {
  ...basicFields,
  ownerInstructorId: z.uuid(),
  inSubscription: z.boolean(),
};

const slug = z
  .string()
  .trim()
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    error: "과정 ID 는 영문 소문자 · 숫자 · - 만 (패키지의 course_id 와 같게)",
  });

export const createCourseSchema = z.object({ slug, ...courseFields });

export const updateCourseSchema = z.object(courseFields);

/** 강사는 기본 정보만 (과정 ID 는 만들 때 한 번, 강사 · 구독 포함 · 가격은 운영자) */
export const instructorCreateCourseSchema = z.object({ slug, ...basicFields });

export const instructorCourseSchema = z.object(basicFields);
