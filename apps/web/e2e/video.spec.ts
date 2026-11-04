// 화면 흐름 (M4): 운영자가 영상 올리기(AD-05, 나눠 올리기 + 자막) ➔ worker 변환 진행 상태 ➔ 영상 자리 연결
// ➔ 수강권 없는 사람: 미리보기에 잠금 카드, 재생 정보 · 조각 · 키 요청 실패 ➔ 수강생: 학습 화면에서 재생(키 받음),
// 워터마크 · 자막 · 시청 기록. 먼저 띄워 둘 것: 개발 터널, web 개발 서버, worker(영상 변환, 이 PC 의 ffmpeg).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { and, createDb, eq, schema } from "@aionit/db";
import { createS3StoreFromEnv } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import {
  createCourse,
  createInstructor,
  publishVersion,
  setPreviewRule,
  uploadPackage,
} from "../src/server/courses";
import { grantEntitlement } from "../src/server/entitlements";
import { grantOperator, login, resetRateLimits, signUpVerified, totp } from "./helpers";

test.describe.configure({ mode: "serial" });

async function withDb<T>(work: (db: ReturnType<typeof createDb>["db"]) => Promise<T>): Promise<T> {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 2, quiet: true });
  try {
    return await work(db);
  } finally {
    await close();
  }
}

/** 시험 과정 공개 + ch01 무료 미리보기 (영상 자리는 비워 둔다) */
async function publishTestCourse(slug: string, title: string, operatorEmail: string) {
  return withDb(async (db) => {
    const store = createS3StoreFromEnv();
    const [operator] = await db.select().from(schema.users).where(eq(schema.users.email, operatorEmail));
    const actorId = operator!.id;
    const instructor = await createInstructor(db, { displayName: "홍길동", actorId });
    const course = await createCourse(db, {
      slug,
      title,
      field: "ai",
      level: "초급",
      ownerInstructorId: instructor.id,
      summary: "",
      descriptionMd: "",
      audienceMd: "",
      requirementsMd: "",
      inSubscription: true,
      actorId,
    });
    const entries = (await normalEntries()).map((e) =>
      e.name === "course.json"
        ? { ...e, data: (e.data as string).replace('"ai-agent-basics"', `"${slug}"`) }
        : e,
    );
    const version = await uploadPackage(
      { db, store, enqueueContent: async () => undefined },
      { courseId: course.id, zip: buildZip(entries), fileName: `${slug}.zip`, actorId },
    );
    await processCourseVersion({ db, store }, version.id);
    await publishVersion(db, version.id, { actorId });
    await setPreviewRule(db, course.id, { chapterKey: "ch01", scope: "whole", actorId });
    return { courseId: course.id, operatorId: actorId };
  });
}

test("운영자가 올린 영상은 수강생만 재생하고, 수강권 없는 사람은 받지 못한다", async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop", "관리 화면 흐름은 데스크톱에서 한 번만");
  test.setTimeout(600_000);
  const stamp = Date.now().toString(36);
  const slug = `e2e-video-${stamp}`;
  const title = `영상 시험 ${stamp}`;
  const password = "Calm-Forest-Engine-31";
  const opEmail = `e2e-vop-${stamp}@example.com`;
  const learnerEmail = `e2e-vlr-${stamp}@example.com`;
  const learnerNick = `vl${stamp}`.slice(0, 16);
  await resetRateLimits();

  // 시험 영상 (20초, 720p, 소리) + 자막
  const work = mkdtempSync(join(tmpdir(), "aionit-e2e-video-"));
  const clip = join(work, "ch01_lab01.mp4");
  execFileSync("ffmpeg", [
    ...["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30"],
    ...["-f", "lavfi", "-i", "sine=frequency=440", "-t", "20"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip],
  ]);
  const srt = join(work, "ch01_lab01.srt");
  writeFileSync(srt, "1\n00:00:00,000 --> 00:00:15,000\n자막 시험 문장입니다\n");

  // 0. 운영자 ➔ 시험 과정
  await signUpVerified(page, opEmail, password, `vo${stamp}`.slice(0, 16));
  await grantOperator(opEmail);
  const { courseId, operatorId } = await publishTestCourse(slug, title, opEmail);

  // 1. 운영자: 2단계 인증 ➔ 과정 상세 ➔ 영상 올리기 (영상 + 자막)
  await login(page, opEmail, password);
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(`/admin/courses/${courseId}`);
  await expect(page).toHaveURL(/\/my\/security\?required=1/);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "2단계 인증 켜기" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("인증 코드 (6자리)").fill(totp(secret));
  await page.getByRole("button", { name: "확인하고 켜기" }).click();
  await page.getByRole("button", { name: "하던 일로 돌아가기" }).click();
  await expect(page.getByRole("heading", { name: "자체 서버 영상 (수강생 전용)" })).toBeVisible();
  await page.getByLabel("영상 제목").fill("실습 1 시연 영상");
  await page.getByLabel(/영상 파일/).setInputFiles(clip);
  await page.getByLabel(/자막 \(srt/).setInputFiles(srt);
  await page.getByRole("button", { name: "영상 올리기", exact: true }).click();

  // 2. 변환 진행 ➔ 재생 가능 (worker)
  const row = page
    .getByRole("list", { name: "올린 영상" })
    .getByRole("listitem")
    .filter({ hasText: "실습 1 시연 영상" });
  await expect(row.getByText(/변환 대기|변환 중|재생 가능/)).toBeVisible({ timeout: 60_000 });
  await expect(row.getByText("재생 가능")).toBeVisible({ timeout: 240_000 });
  await expect(row).toContainText("360p");
  await expect(row).toContainText("720p");
  await expect(row).toContainText("자막 ko");

  // 3. 영상 자리 ch01_lab01 에 연결
  const slotSelect = page.locator("#hosted-ch01_lab01");
  await slotSelect.selectOption({ label: "실습 1 시연 영상" });
  await slotSelect.locator("xpath=..").getByRole("button", { name: "연결" }).click();
  await expect(row).toContainText("연결: ch01_lab01");

  // 4. 수강권 없는 사람: 미리보기에는 잠금 카드, 재생 정보 · 조각 · 키는 받지 못한다
  const learnerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const learner = await learnerContext.newPage();
  await signUpVerified(learner, learnerEmail, password, learnerNick);
  await login(learner, learnerEmail, password);
  await learner.waitForURL((url) => url.pathname === "/");
  await learner.goto(`/courses/${slug}/preview/ch01`);
  await expect(learner.getByText("수강생 전용 영상입니다")).toBeVisible();
  const denied = await learner.request.post("/api/v1/learn/videos/playback", {
    data: { courseId, videoKey: "ch01_lab01" },
    headers: { origin: new URL(learner.url()).origin },
  });
  expect(denied.status()).toBe(403);
  const assetId = await withDb(async (db) => {
    const [slot] = await db
      .select()
      .from(schema.videoSlots)
      .where(and(eq(schema.videoSlots.courseId, courseId), eq(schema.videoSlots.key, "ch01_lab01")));
    return slot!.videoAssetId!;
  });
  expect((await learner.request.get(`/media/v/${assetId}/hls/master.m3u8`)).status()).toBe(401);
  expect((await learner.request.get(`/api/v1/hls/keys/${assetId}`)).status()).toBe(403);

  // 5. 수강권 발급 ➔ 학습 화면에서 재생: 키를 받아 풀고, 워터마크 · 자막이 보이고, 시청 구간이 학습 신호로 간다
  const [learnerRow] = await withDb((db) =>
    db.select().from(schema.users).where(eq(schema.users.email, learnerEmail)),
  );
  await withDb((db) =>
    grantEntitlement(db, { actorId: operatorId, userId: learnerRow!.id, courseId, days: 30, reason: "시험" }),
  );
  await learner.goto(`/learn/${slug}/ch01`);
  const keyLoaded = learner.waitForResponse(
    (r) => r.url().includes(`/api/v1/hls/keys/${assetId}`) && r.status() === 200,
  );
  const watched = learner.waitForRequest(
    (r) =>
      r.url().endsWith("/api/v1/learn/heartbeats") &&
      (r.postData() ?? "").includes('"videoKey":"ch01_lab01"'),
    { timeout: 60_000 },
  );
  await learner.getByRole("button", { name: /실습 1 시연 재생/ }).click();
  await keyLoaded;
  const video = learner.locator(".hosted-player video");
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 30_000 })
    .toBeGreaterThan(2);
  await expect(
    learner.locator(".hosted-player").getByText(new RegExp(`${learnerNick} · #[0-9A-F]{6}`)),
  ).toBeVisible();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.textTracks.length)).toBeGreaterThan(0);
  await learner.screenshot({ path: join(work, "learn-hosted.png") });
  await watched;
  console.warn(`스크린샷: ${join(work, "learn-hosted.png")}`);
  await learnerContext.close();
});
