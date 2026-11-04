// 화면 흐름 (M7): 학습 화면 Q&A ➔ API 키 경고 ➔ 질문 · 비밀글 ➔ 다른 수강생 답변 · 신고 ➔ 알림 · 메일 ➔ 해결됨
// ➔ 1:1 문의 ➔ 운영자 답변 · Q&A 숨김 · 공지 · 자주 묻는 질문 ➔ 알림 설정 ➔ 모바일 폭 Q&A.
// 과정 · 수강권은 서버 함수로 바로 만든다 (그 화면들은 content-admin · learning spec 이 본다).
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createDb, eq, schema, sql } from "@aionit/db";
import { createS3StoreFromEnv } from "@aionit/storage";
import { processCourseVersion } from "../../worker/src/content";
import { buildZip, normalEntries } from "../../../packages/content/test/fixtures";
import { createCourse, createInstructor, publishVersion, uploadPackage } from "../src/server/courses";
import { grantEntitlement } from "../src/server/entitlements";
import { grantOperator, login, resetRateLimits, signUpVerified, totp } from "./helpers";

test.describe.configure({ mode: "serial" });

const KEY = "sk-proj-AbCdEf0123456789AbCdEf0123456789xyz";

async function setupCourse(slug: string, title: string, operatorEmail: string, learnerEmails: string[]) {
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
    for (const email of learnerEmails) {
      const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
      await grantEntitlement(db, {
        actorId,
        userId: user!.id,
        courseId: course.id,
        days: 90,
        reason: "화면 흐름 테스트",
      });
    }
  } finally {
    await close();
  }
}

async function member(browser: Browser, email: string, password: string, nickname: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await signUpVerified(page, email, password, nickname);
  await login(page, email, password);
  await page.waitForURL((url) => url.pathname === "/");
  return page;
}

/**
 * 메일이 나갔나 (email_logs). 개발 PC 에는 다른 세션의 worker 가 여럿 떠 있어 옛 코드 worker 가 받으면 Mailpit 의
 * 내용이 비어 있을 수 있다. 메일 문안은 packages/mail 단위 테스트와 테스트 서버에서 본다
 */
async function mailSent(email: string, template: string) {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 1, quiet: true });
  try {
    for (let i = 0; i < 30; i++) {
      const rows = await db.execute(
        sql`select 1 from email_logs l join users u on u.id = l.to_user_id
            where lower(u.email) = ${email.toLowerCase()} and l.template = ${template} and l.status = 'sent'`,
      );
      if (rows.length > 0) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  } finally {
    await close();
  }
}

/** 시험 공지 · FAQ 는 지운다 (개발 DB 를 같이 쓰므로, 지난번에 실패해 남은 것도) */
async function removeTestNotices() {
  const { db, close } = createDb(process.env.DATABASE_URL!, { max: 1, quiet: true });
  try {
    await db.delete(schema.notices).where(sql`${schema.notices.title} like '[e2e]%'`);
    await db.delete(schema.faqs).where(sql`${schema.faqs.question} like '[e2e]%'`);
  } finally {
    await close();
  }
}

const qna = (page: Page) => page.getByRole("dialog", { name: "강의 Q&A" });

test("질문 · 답변 · 비밀글 · 신고 · 알림 · 해결됨 ➔ 1:1 문의 ➔ 운영자 답변 · 숨김 · 공지 · FAQ", async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== "desktop", "흐름은 데스크톱에서 한 번만 (모바일 폭은 아래에서 따로 본다)");
  test.setTimeout(420_000);
  const stamp = Date.now().toString(36);
  const slug = `e2e-qna-${stamp}`;
  const title = `Q&A 시험 ${stamp}`;
  const password = "Calm-Forest-Engine-31";
  const opEmail = `e2e-op-${stamp}@example.com`;
  const askerEmail = `e2e-asker-${stamp}@example.com`;
  const mateEmail = `e2e-mate-${stamp}@example.com`;
  const question = `응답이 비어 있어요 ${stamp}`;
  await resetRateLimits();
  await removeTestNotices();

  await signUpVerified(page, opEmail, password, `op${stamp}`.slice(0, 16));
  await grantOperator(opEmail);
  const asker = await member(browser, askerEmail, password, `ask${stamp}`.slice(0, 16));
  const mate = await member(browser, mateEmail, password, `mate${stamp}`.slice(0, 16));
  await setupCourse(slug, title, opEmail, [askerEmail, mateEmail]);

  // 1. 질문자: 학습 화면 머리글 [Q&A 0] ➔ 패널 ➔ 질문하기 ➔ API 키 경고 ➔ 고쳐서 올리기
  await asker.goto(`/learn/${slug}/ch01`);
  await asker.getByRole("button", { name: /^Q&A, 이 챕터의 미해결 질문 0개/ }).click();
  await expect(qna(asker).getByText("아직 질문이 없습니다.", { exact: false })).toBeVisible();
  await qna(asker).getByRole("button", { name: "질문하기" }).click();
  await qna(asker).getByLabel("제목").fill(question);
  await qna(asker).getByLabel("내용").fill(`client = OpenAI(api_key="${KEY}")\n\nprint 가 빈 칸입니다.`);
  await qna(asker).getByRole("button", { name: "질문 올리기" }).click();
  await expect(qna(asker).getByText("API 키처럼 보이는 글자가 있습니다.", { exact: false })).toBeVisible();
  await expect(qna(asker).getByText("OpenAI API 키: sk-proj-••••••")).toBeVisible();
  await qna(asker).getByRole("button", { name: "고쳐서 올리기" }).click();
  await qna(asker)
    .getByLabel("내용")
    .fill("```python\nclient = OpenAI()\nprint(resp)\n```\nprint 가 빈 칸입니다.");
  await qna(asker).getByRole("button", { name: "질문 올리기" }).click();
  await expect(qna(asker).getByRole("heading", { name: question })).toBeVisible();
  await expect(qna(asker).getByLabel("python 코드")).toContainText("print(resp)");
  // 비밀글 하나 더
  await qna(asker).getByRole("button", { name: "목록으로" }).click();
  await qna(asker).getByRole("button", { name: "질문하기" }).click();
  await qna(asker).getByLabel("제목").fill("결제한 카드가 보여요");
  await qna(asker).getByLabel("내용").fill("제 계정 문제입니다.");
  await qna(asker).getByText("비밀글 (나 · 강사 · 운영자만 봅니다)").click();
  await qna(asker).getByRole("button", { name: "질문 올리기" }).click();
  await expect(qna(asker).getByText("비밀글", { exact: true })).toBeVisible();
  await expect(asker.getByRole("button", { name: /미해결 질문 2개/ })).toBeVisible();

  // 2. 다른 수강생: 비밀글은 "비밀글입니다" 만 ➔ 공개 질문에 답변 · 신고
  await mate.goto(`/learn/${slug}/ch01`);
  await mate.getByRole("button", { name: /^Q&A,/ }).click();
  await expect(qna(mate).getByText("비밀글입니다")).toBeVisible();
  await expect(qna(mate).getByText("결제한 카드가 보여요")).toHaveCount(0);
  await qna(mate).getByPlaceholder("같은 질문 찾기").fill("비어");
  await qna(mate)
    .getByRole("button", { name: new RegExp(question) })
    .click();
  await qna(mate).getByLabel("답변 쓰기").fill("`content[0].text` 를 읽어 보세요.");
  await qna(mate).getByRole("button", { name: "답변 올리기" }).click();
  await expect(qna(mate).getByText("답변 1")).toBeVisible();
  await qna(mate).getByRole("button", { name: "신고", exact: true }).click();
  await qna(mate).getByLabel("신고 사유").selectOption("기타");
  await qna(mate).getByRole("button", { name: "신고하기" }).click();
  await expect(qna(mate).getByText("신고했습니다. 운영자가 확인합니다.")).toBeVisible();

  // 3. 질문자: 머리글 알림 ➔ 알림 ➔ 학습 화면에서 그 질문이 열린다 ➔ 해결됨. 메일도 왔다
  await asker.goto("/my/notifications");
  await expect(asker.getByRole("link", { name: /알림, 읽지 않은 알림 1개/ })).toBeVisible();
  await asker.getByRole("link", { name: new RegExp(`새 답변: ${question}`) }).click();
  await expect(qna(asker).getByRole("heading", { name: question })).toBeVisible();
  await expect(qna(asker).getByText("content[0].text")).toBeVisible();
  await qna(asker).getByRole("button", { name: "해결됨" }).click();
  await expect(qna(asker).getByText("해결됨", { exact: true })).toBeVisible();
  expect(await mailSent(askerEmail, "qna-answer")).toBe(true);

  // 4. 질문자: 알림 설정 (Q&A 답변 메일 끄기) · 1:1 문의
  await asker.goto("/my");
  const qnaMail = asker.getByRole("checkbox", { name: "내 질문에 답변이 달리면 메일로 알림" });
  await expect(qnaMail).toBeChecked();
  await qnaMail.uncheck();
  await expect(asker.getByText("알림 설정을 저장했습니다.")).toBeVisible();
  await asker.reload();
  await expect(qnaMail).not.toBeChecked();
  await asker.goto("/my/inquiries");
  await asker.getByRole("link", { name: "문의하기" }).click();
  await asker.getByLabel("문의 종류").selectOption("결제 · 환불");
  await asker.getByLabel("제목").fill("환불 문의");
  await asker.getByLabel("내용").fill("결제 내역에 환불 버튼이 없습니다.");
  await asker.getByRole("button", { name: "문의 보내기" }).click();
  await expect(asker.getByRole("heading", { name: "환불 문의" })).toBeVisible();
  await expect(asker.getByText("답변 기다림")).toBeVisible();

  // 5. 운영자: 2단계 인증 ➔ 대시보드 ➔ 문의 답변 ➔ 신고된 글 숨김 ➔ 공지 · FAQ
  await login(page, opEmail, password);
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/my\/security\?required=1/);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "2단계 인증 켜기" }).click();
  const secret = (await page.locator("code").first().textContent())!.trim();
  await page.getByLabel("인증 코드 (6자리)").fill(totp(secret));
  await page.getByRole("button", { name: "확인하고 켜기" }).click();
  await page.getByRole("button", { name: "하던 일로 돌아가기" }).click();
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await page.getByRole("link", { name: "1:1 문의" }).first().click();
  await page.getByRole("link", { name: /환불 문의/ }).click();
  await page.getByLabel("답변").fill("7일이 지나 규정상 부분 환불입니다. 결제 내역에서 요청해 주세요.");
  await page.getByRole("button", { name: "답변 보내기" }).click();
  await expect(page.getByText("답변 완료")).toBeVisible();
  await expect(page.getByText("AIONIT 운영자")).toBeVisible();

  await page.goto("/admin/qna");
  const reported = page
    .getByRole("region", { name: "신고된 글" })
    .getByRole("listitem")
    .filter({ hasText: question });
  await expect(reported.getByText("신고 1건 · 기타", { exact: false })).toBeVisible();
  await reported.getByPlaceholder("숨기는 사유 (작성자에게 알림)").fill("시험용 숨김");
  await reported.getByRole("button", { name: "숨기기" }).click();
  await expect(reported).toHaveCount(0);
  await expect(page.getByRole("region", { name: "숨긴 글" }).getByText(question)).toBeVisible();

  await page.goto("/admin/notices");
  await page.getByLabel("제목").fill(`[e2e] 점검 안내 ${stamp}`);
  await page
    .getByLabel("내용")
    .fill("11월 10일 새벽 2시부터 30분 동안 점검합니다.\n\n- 학습 진도는 그대로입니다.");
  await page.getByRole("button", { name: "게시하기" }).click();
  await expect(page.getByRole("heading", { name: "공지 고치기" })).toBeVisible();
  await page.goto("/admin/faqs");
  const newFaq = page.getByRole("region", { name: "질문 더하기" });
  await newFaq.getByLabel("분류").fill("결제 · 환불");
  await newFaq.getByLabel("질문").fill(`[e2e] 환불은 언제까지 되나요? ${stamp}`);
  await newFaq
    .getByLabel("답", { exact: true })
    .fill(`결제일부터 7일 이내 · 이용 전이면 전액 환불됩니다. ${stamp}`);
  await newFaq.getByRole("button", { name: "더하기" }).click();
  await expect(newFaq.getByText("저장했습니다.")).toBeVisible();

  // 6. 수강생: 숨긴 질문은 사라짐 · 공지 · FAQ · 문의 답변 알림
  await mate.goto(`/learn/${slug}/ch01`);
  await mate.getByRole("button", { name: /^Q&A,/ }).click();
  await expect(qna(mate).getByText("비밀글입니다")).toBeVisible();
  await expect(qna(mate).getByText(question)).toHaveCount(0);
  await mate.goto("/");
  await mate.getByRole("link", { name: "공지", exact: true }).click();
  await mate.getByRole("link", { name: `[e2e] 점검 안내 ${stamp}` }).click();
  await expect(mate.getByText("학습 진도는 그대로입니다.")).toBeVisible();
  await mate.goto("/faq");
  await mate.getByText(`[e2e] 환불은 언제까지 되나요? ${stamp}`).click();
  await expect(mate.getByText(`결제일부터 7일 이내 · 이용 전이면 전액 환불됩니다. ${stamp}`)).toBeVisible();

  await asker.goto("/my/notifications");
  await asker.getByRole("link", { name: /1:1 문의 답변: 환불 문의/ }).click();
  await expect(asker.getByText("7일이 지나 규정상 부분 환불입니다.", { exact: false })).toBeVisible();
  await asker.getByRole("button", { name: "해결됐어요 (문의 닫기)" }).click();
  await expect(asker.getByText("끝난 문의입니다.", { exact: false })).toBeVisible();
  expect(await mailSent(askerEmail, "inquiry-answer")).toBe(true);
  // 질문자에게 숨김 알림 (사유)
  await asker.goto("/my/notifications");
  await expect(asker.getByText("사유: 시험용 숨김")).toBeVisible();

  await removeTestNotices();
});

test("모바일 폭: Q&A 는 전체 화면으로 열리고 가로 스크롤이 생기지 않는다", async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== "mobile", "모바일 폭에서만");
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  const slug = `e2e-qna-m-${stamp}`;
  const password = "Calm-Forest-Engine-31";
  const opEmail = `e2e-opm-${stamp}@example.com`;
  const learnerEmail = `e2e-lm-${stamp}@example.com`;
  await resetRateLimits();
  const opContext = await browser.newContext();
  await signUpVerified(await opContext.newPage(), opEmail, password, `opm${stamp}`.slice(0, 16));
  await opContext.close();
  await signUpVerified(page, learnerEmail, password, `lm${stamp}`.slice(0, 16));
  await setupCourse(slug, `Q&A 모바일 ${stamp}`, opEmail, [learnerEmail]);
  await login(page, learnerEmail, password);
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(`/learn/${slug}/ch01`);
  await page.getByRole("button", { name: /^Q&A,/ }).click();
  const panel = page.locator("aside").filter({ has: qna(page) });
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(370);
  expect(box.x).toBe(0);
  await qna(page).getByRole("button", { name: "질문하기" }).click();
  await qna(page).getByLabel("제목").fill("모바일에서 질문");
  await qna(page)
    .getByLabel("내용")
    .fill("```\n" + "x".repeat(200) + "\n```");
  await qna(page).getByRole("button", { name: "질문 올리기" }).click();
  await expect(qna(page).getByRole("heading", { name: "모바일에서 질문" })).toBeVisible();
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(scroll).toBeLessThanOrEqual(0);
  await qna(page).getByRole("button", { name: "Q&A 닫기" }).click();
  await expect(qna(page)).toHaveCount(0);
});
