import "server-only";
import { createAuth } from "./auth";
import type { Auth } from "./auth";
import { getDb } from "./db";
import { getEnv } from "./env";
import { enqueueMail } from "./queue";

const globalForAuth = globalThis as unknown as { aionitAuth?: Auth };

/** 앱 전체에서 쓰는 인증 객체 하나 */
export function getAuth(): Auth {
  globalForAuth.aionitAuth ??= createAuth({ db: getDb(), env: getEnv(), enqueueMail });
  return globalForAuth.aionitAuth;
}
