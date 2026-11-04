import "server-only";
import { getDb } from "./db";
import { getEnv } from "./env";
import type { QnaDeps } from "./qna";
import { enqueueMail } from "./queue";

/** Q&A · 1:1 문의 서버 함수에 넘기는 것 (메일 대기열 · 메일 속 주소의 기준) */
export function supportDeps(): QnaDeps {
  return { db: getDb(), enqueueMail, baseUrl: getEnv().BETTER_AUTH_URL.replace(/\/$/, "") };
}
