// 화면 흐름 (M3): 수강권 없음 ➔ L-05 / 운영자가 회원 상세에서 수강권 발급(AD-08) ➔ 내 강의실(L-01) ➔ 학습 화면(L-02)
// ➔ 실습 체크 · 읽은 위치 저장 ➔ 다른 브라우저에서 이어진다 ➔ 다크 모드 ➔ 모바일 폭.
// 과정은 서버 함수로 바로 만든다 (교재 올리기 화면은 content-admin.spec 이 본다).
import { expect, test } from "@playwright/test";
import { and, createDb, eq, schema } from "@aionit/db";
import { createS3StoreFromEnv } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import {
  createCourse,
  createInstructor,
  linkYoutube,
  publishVersion,
  uploadPackage,
} from "../src/server/courses";
import { grantOperator, login, resetRateLimits, signUpVerified, totp } from "./helpers";

test.describe.configure({ mode: "serial" });

async function publishTestCourse(slug: string, title: string, operatorEmail: string) {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 2, quiet: true });
  const store = createS3StoreFromEnv();
  try {
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
    const [main] = await db
      .select()
      .from(schema.videoSlots)
      .where(and(eq(schema.videoSlots.courseId, course.id), eq(schema.videoSlots.key, "ch01_main")));
    await linkYoutube(db, main!.id, { url: "https://youtu.be/dQw4w9WgXcQ", actorId });
  } finally {
    await close();
  }
}

test("운영자가 수강권을 발급하면 수강생이 학습하고, 체크 · 읽은 위치가 다른 브라우저에서도 이어진다", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "관리 화면 흐름은 데스크톱에서 한 번만 (모바일 폭은 아래에서 따로 본다)",
  );
  test.setTimeout(300_000);
  const stamp = Date.now().toString(36);
  const slug = `e2e-learn-${stamp}`;
  const title = `학습 시험 ${stamp}`;
  const password = "Calm-Forest-Engine-31";
  const opEmail = `e2e-op-${stamp}@example.com`;
  const learnerEmail = `e2e-learner-${stamp}@example.com`;
  await resetRateLimits();

  // 0. 운영자 가입 ➔ 운영자 역할 ➔ 시험 과정 공개
  await signUpVerified(page, opEmail, password, `op${stamp}`.slice(0, 16));
  await grantOperator(opEmail);
  await publishTestCourse(slug, title, opEmail);

  // 1. 수강생 가입. 수강권이 없으면 L-05
  const learnerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const learner = await learnerContext.newPage();
  await signUpVerified(learner, learnerEmail, password, `lr${stamp}`.slice(0, 16));
  await login(learner, learnerEmail, password);
  await learner.waitForURL((url) => url.pathname === "/");
  await learner.goto(`/learn/${slug}/ch01`);
  await expect(learner.getByRole("heading", { name: "이 강의의 수강권이 없습니다" })).toBeVisible();
  await learner.goto("/learn");
  await expect(learner.getByText("아직 수강 중인 강의가 없습니다.")).toBeVisible();

  // 2. 운영자: 2단계 인증 ➔ 회원 상세 ➔ 수강권 발급 (사유 필수)
  await login(page, opEmail, password);
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(`/admin/users?q=${encodeURIComponent(learnerEmail)}`);
  await expect(page).toHaveURL(/\/my\/security\?required=1/);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "2단계 인증 켜기" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("인증 코드 (6자리)").fill(totp(secret));
  await page.getByRole("button", { name: "확인하고 켜기" }).click();
  await page.getByRole("button", { name: "하던 일로 돌아가기" }).click();
  await page
    .getByRole("link", { name: new RegExp(`lr${stamp}`.slice(0, 16)) })
    .first()
    .click();
  await page.getByLabel("과정").selectOption({ label: title });
  await page.getByLabel("기간 (오늘부터)").selectOption({ label: "90일" });
  const grant = page.getByRole("button", { name: "수강권 발급" });
  await expect(grant).toBeDisabled(); // 사유 없이는 안 된다
  await page.getByLabel("사유 (기록에 남습니다)").last().fill("베타 수강생");
  await grant.click();
  await expect(page.getByText(/운영자 발급 · .* · 이용 중 · 아직 이용 안 함 — 베타 수강생/)).toBeVisible();

  // 3. 수강생: 내 강의실 ➔ 학습 시작 ➔ 학습 화면
  await learner.goto("/learn");
  await expect(learner.getByRole("link", { name: title })).toBeVisible();
  await learner.getByRole("link", { name: "학습 시작" }).click();
  await expect(learner).toHaveURL(new RegExp(`/learn/${slug}/ch01$`));
  await expect(learner.getByRole("navigation", { name: "목차" }).first()).toBeVisible();
  await expect(learner.locator('iframe[data-video-key="ch01_main"]')).toHaveAttribute("src", /enablejsapi=1/);
  // 워터마크 · 진도 막대
  await expect(learner.getByRole("progressbar", { name: "과정 진도" }).first()).toBeVisible();

  // 실습 체크 ➔ 바로 저장
  const check = learner.getByRole("checkbox", { name: "결과가 보인다" });
  const saved = learner.waitForResponse(
    (r) => r.url().endsWith("/api/v1/learn/checks") && r.status() === 200,
  );
  await check.check();
  await saved;
  await expect(learner.locator(".self-check-title")).toContainText("1 / 1");

  // 유튜브 재생 ➔ 30초 안에 시청 구간이 학습 신호로 간다
  const watched = learner.waitForRequest(
    (r) => r.url().endsWith("/api/v1/learn/heartbeats") && (r.postData() ?? "").includes('"kind":"video"'),
    { timeout: 60_000 },
  );
  // 유튜브 플레이어 모양은 바뀔 수 있어 이름(접근성 라벨)으로 찾는다
  await learner
    .frameLocator("figure.video-block iframe")
    .first()
    .getByRole("button", { name: /재생|Play/ })
    .first()
    .click();
  const beat = JSON.parse((await watched).postData()!) as { beats: { kind: string; ranges?: number[][] }[] };
  const ranges = beat.beats.find((b) => b.kind === "video")!.ranges!;
  expect(ranges[0]![1]! - ranges[0]![0]!).toBeGreaterThan(5);

  // 끝까지 내려가고 5초 ➔ 읽은 위치 저장
  const progress = learner.waitForResponse(
    (r) => r.url().endsWith("/api/v1/learn/progress") && r.status() === 200,
    {
      timeout: 20_000,
    },
  );
  await learner.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await progress;

  // 4. 다른 브라우저(새로 로그인)에서 이어진다
  const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const second = await other.newPage();
  await login(second, learnerEmail, password);
  await second.waitForURL((url) => url.pathname === "/");
  await second.goto("/learn");
  await second.getByRole("link", { name: "이어서 학습" }).click();
  await expect(second).toHaveURL(new RegExp(`/learn/${slug}/ch01$`));
  await expect(second.getByRole("checkbox", { name: "결과가 보인다" })).toBeChecked();
  await expect(second.getByText("마지막으로 읽은 곳:")).toBeVisible();

  // 5. 다크 모드: 고른 값이 남는다
  await second.getByRole("button", { name: "어두운 화면으로" }).click();
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
  await second.reload();
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
  await second.screenshot({ path: info.outputPath("learn-dark.png"), fullPage: false });

  // 6. 모바일 폭: 아래 고정 막대 · 목차 시트, 가로로 넘치지 않는다
  await second.setViewportSize({ width: 375, height: 812 });
  await second.reload();
  // 열기만 하고 다시 열어도 마지막으로 읽은 곳은 그대로
  await expect(second.getByText("마지막으로 읽은 곳:")).toBeVisible();
  const bar = second.getByRole("navigation", { name: "챕터 이동" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "목차" }).click();
  await expect(second.getByRole("dialog", { name: "목차" })).toBeVisible();
  await second.getByRole("button", { name: "목차 닫기" }).click();
  const overflow = await second.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await second.screenshot({ path: info.outputPath("learn-mobile.png"), fullPage: false });

  // 운영자 화면: 영상을 재생했으니 첫 이용이 적혀 있다 (환불 판단 근거)
  await page.reload();
  await expect(page.getByText(/· 첫 이용 /)).toBeVisible();
  await learner.screenshot({ path: info.outputPath("learn-desktop.png"), fullPage: false });
  await learnerContext.close();
  await other.close();
});
