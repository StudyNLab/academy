// 화면 흐름 테스트 도우미: Mailpit 메일 링크, 가입, 운영자 만들기(DB), TOTP 코드
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { config } from "dotenv";
import { createDb, eq, schema, sql } from "@aionit/db";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:18025";

/** 그 주소로 온 가장 최근 메일의 링크 (최대 30초 기다림) */
export async function linkFromMail(to: string, subject: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json()) as {
        Text: string;
      };
      const url = message.Text.match(/https?:\/\/\S+/)?.[0];
      if (url) return url;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${to} 에게 '${subject}' 메일이 오지 않았습니다`);
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

/** 가입 ➔ 메일 인증까지 */
export async function signUpVerified(page: Page, email: string, password: string, nickname: string) {
  await page.goto("/signup");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("닉네임").fill(nickname);
  await page.getByText("모두 동의합니다").click();
  await page.getByRole("button", { name: "이메일로 가입하기" }).click();
  await expect(page.getByRole("heading", { name: "메일함을 확인해 주세요" })).toBeVisible();
  await page.goto(await linkFromMail(email, "이메일 주소를 확인해 주세요"));
  await expect(page.getByText("이메일 확인이 끝났습니다")).toBeVisible();
}

/** 운영자 역할 주기 (서버 명령 grant-role 과 같은 일) */
export async function grantOperator(email: string) {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 1, quiet: true });
  try {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    await db
      .insert(schema.userRoles)
      .values({ userId: user!.id, role: "operator", reason: "화면 흐름 테스트" });
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user!.id));
  } finally {
    await close();
  }
}

/** 인증 앱 대신 TOTP 코드 (RFC 6238) */
export function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32Secret.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/** 개발 DB 의 IP 횟수 제한 카운터를 비운다 (같은 PC 에서 가입 시험을 여러 번 하므로). 개발 DB 에서만 쓴다 */
export async function resetRateLimits() {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 1, quiet: true });
  try {
    await db.delete(schema.rateLimits);
  } finally {
    await close();
  }
}
