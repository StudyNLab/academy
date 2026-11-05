import "server-only";
import { forbidden, notFound } from "next/navigation";
import { CourseError } from "./courses";
import { getDb } from "./db";
import { myInstructor, ownedCourse } from "./instructors";
import { requireStaff } from "./session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 강사 화면 (I-01 ~ I-09): 강사 역할 + 2단계 인증 + 이 회원에 이어진 강사 프로필 */
export async function instructorPage(next: string) {
  const viewer = await requireStaff("instructor", next);
  const db = getDb();
  const instructor = await myInstructor(db, viewer);
  if (!instructor) forbidden();
  return { viewer, instructor, db };
}

/** 내 과정 화면. 남의 과정 · 없는 과정은 404 */
export async function ownCoursePage(id: string, next: string) {
  const page = await instructorPage(next);
  if (!UUID.test(id)) notFound();
  try {
    const { course } = await ownedCourse(page.db, page.viewer, id);
    return { ...page, course };
  } catch (error) {
    if (error instanceof CourseError && error.status === 404) notFound();
    throw error;
  }
}

export const isUuid = (value: string) => UUID.test(value);
