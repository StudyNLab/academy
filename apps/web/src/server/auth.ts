// 인증 설정 (Better Auth). 보안 기본안: docs/기술설계.md 3.1 (2026-11-04 운영자 확정)
// - 이메일 · 비밀번호(argon2id) + 구글 · 카카오, DB 세션 쿠키 (HttpOnly · SameSite=Lax · https 면 Secure)
// - 로그인 횟수 제한: IP (Better Auth rateLimit) + 계정 (login_logs 로 15분 10회 ➔ 15분 잠금)
// - 같은 이메일의 다른 로그인 방식은 자동으로 잇지 않는다 (A-05: 로그인한 뒤 내 정보에서 연결)
// - 운영자 · 강사: 2단계 인증 필수, 세션 12시간 (session.ts 에서 확인)
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import type { Db } from "@aionit/db";
import { and, eq, schema } from "@aionit/db";
import {
  checkPassword,
  IP_RATE_LIMITS,
  LOGIN_LOCKOUT,
  lockedUntil,
  normalizeEmail,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MESSAGES,
  PASSWORD_MIN_LENGTH,
  placeholderEmail,
  SESSION_POLICY,
} from "@aionit/core";
import type { MailJob } from "@aionit/mail";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { recordSignupConsents, signupExtrasSchema, validateSignupExtras } from "./consents";
import type { Env } from "./env";
import { clientIp, identifierHash, isPrivilegedUser, recentFailures, recordLogin } from "./records";

export const AUTH_BASE_PATH = "/api/v1/auth";

/** 로그인 중에 OTP 를 다시 확인할 때(관리자 화면 진입)의 시도 제한: 15분 5회 ➔ 15분 잠금 */
const STEP_UP_LOCKOUT = { ...LOGIN_LOCKOUT, maxFailures: 5 } as const;

// OWASP 권장 최소값 (메모리 19MiB, 반복 2, 병렬 1). 라이브러리 기본 알고리즘이 argon2id 다.
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };

export interface AuthDeps {
  db: Db;
  env: Env;
  /** 메일은 대기열에 넣고 worker 가 보낸다. 테스트에서는 모아 두는 함수로 바꾼다. */
  enqueueMail: (job: MailJob) => Promise<void>;
}

function fail(
  status: "BAD_REQUEST" | "FORBIDDEN" | "TOO_MANY_REQUESTS",
  code: string,
  message: string,
): never {
  throw new APIError(status, { code, message });
}

function minutesUntil(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60_000));
}

export function createAuth({ db, env, enqueueMail }: AuthDeps) {
  const secureCookies = env.BETTER_AUTH_URL.startsWith("https://");
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account" as const,
            // 가입은 가입 화면(동의 · 닉네임을 받은 뒤)에서만. 로그인 화면에서 처음 오면 가입 화면으로 보낸다.
            disableImplicitSignUp: true,
            // 이름 · 사진은 받지 않는다 (닉네임은 가입 화면에서, 최소 수집)
            mapProfileToUser: () => ({ image: undefined }),
          },
        }
      : {};
  const kakao =
    env.KAKAO_CLIENT_ID && env.KAKAO_CLIENT_SECRET
      ? {
          kakao: {
            clientId: env.KAKAO_CLIENT_ID,
            clientSecret: env.KAKAO_CLIENT_SECRET,
            disableImplicitSignUp: true,
            // 테스트 기간(비즈 앱 전)에는 이메일을 받을 수 없어 닉네임 동의만 요청한다
            disableDefaultScope: true,
            scope: ["profile_nickname"],
            // 이메일이 없으면 카카오 회원번호로 만든 자리표시 주소 (로그인할 때마다 같은 값)
            mapProfileToUser: (profile: { id: number | string; kakao_account?: { email?: string } }) => ({
              image: undefined,
              ...(profile.kakao_account?.email
                ? {}
                : { email: placeholderEmail("no-email", `kakao-${profile.id}`), emailVerified: false }),
            }),
          },
        }
      : {};

  const auth = betterAuth({
    appName: "AIONIT",
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        authAccounts: schema.authAccounts,
        verifications: schema.verifications,
        twoFactors: schema.twoFactors,
        rateLimits: schema.rateLimits,
      },
    }),
    user: {
      modelName: "users",
      fields: { name: "nickname" },
      additionalFields: {
        nicknameChangedAt: { type: "date", required: false, input: false },
        age14ConfirmedAt: { type: "date", required: false, input: false },
        status: { type: "string", required: false, input: false, defaultValue: "active" },
        withdrawnAt: { type: "date", required: false, input: false },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: SESSION_POLICY.memberExpiresInSec,
      updateAge: SESSION_POLICY.updateAgeSec,
      additionalFields: { mfaVerifiedAt: { type: "date", required: false, input: false } },
    },
    account: {
      modelName: "authAccounts",
      encryptOAuthTokens: true,
      // 자동 연결은 하지 않는다 (A-05). 로그인한 상태에서 내 정보 ➔ 연결하기로만 잇는다.
      // 이때는 이미 본인 확인(로그인)을 했으므로 이메일이 달라도(카카오는 이메일이 없다) 연결을 허용한다.
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        trustedProviders: ["google", "kakao"],
      },
    },
    verification: { modelName: "verifications", storeIdentifier: "hashed" },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: {
        hash: (password) => argonHash(password, ARGON2),
        verify: ({ hash, password }) => argonVerify(hash, password),
      },
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await enqueueMail({ template: "reset-password", to: user.email, userId: user.id, url });
      },
      onPasswordReset: async ({ user }) => {
        await enqueueMail({ template: "password-changed", to: user.email, userId: user.id });
      },
      // 이미 있는 이메일로 가입하면 화면에는 똑같이 "메일을 보냈습니다"가 나오고, 주인에게 알림 메일이 간다
      onExistingUserSignUp: async ({ user }) => {
        await enqueueMail({
          template: "signup-existing",
          to: user.email,
          userId: user.id,
          loginUrl: `${env.BETTER_AUTH_URL}/login`,
          resetUrl: `${env.BETTER_AUTH_URL}/forgot-password`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => {
        await enqueueMail({ template: "verify-email", to: user.email, userId: user.id, url });
      },
    },
    socialProviders: { ...google, ...kakao },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": IP_RATE_LIMITS.signIn,
        "/sign-up/email": IP_RATE_LIMITS.signUp,
        "/request-password-reset": IP_RATE_LIMITS.passwordReset,
        "/reset-password": IP_RATE_LIMITS.passwordReset,
        "/send-verification-email": IP_RATE_LIMITS.verificationEmail,
        "/two-factor/*": IP_RATE_LIMITS.twoFactor,
      },
    },
    // 닉네임 변경은 30일 규칙이 있어 우리 API(/api/v1/me/nickname)로만 한다
    disabledPaths: ["/update-user"],
    onAPIError: { errorURL: "/auth-error" },
    advanced: {
      database: { generateId: false }, // id 는 DB 가 uuidv7() 로 만든다
      cookiePrefix: "aionit",
      useSecureCookies: secureCookies,
      // 라이브러리는 테스트 환경에서 Origin 확인을 끈다. 어디서든 켜 둔다 (CSRF 방어, 테스트로 확인)
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    plugins: [
      twoFactor({
        issuer: "AIONIT",
        twoFactorTable: "twoFactors",
        backupCodeOptions: { amount: 10, length: 10 },
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
        // 구글 · 카카오로만 가입한 회원(비밀번호 없음)도 켤 수 있게. 대신 아래 before 에서 "방금 로그인"을 확인한다
        allowPasswordless: true,
      }),
    ],

    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const extras = await signupExtrasFrom(ctx);
            if (extras === "none") return; // 서버 명령 · 테스트에서 직접 만든 경우
            if (!extras.ok) fail("BAD_REQUEST", extras.problem.code, extras.problem.message);
            return {
              data: {
                ...user,
                name: extras.extras.nickname,
                email: normalizeEmail(user.email),
                age14ConfirmedAt: new Date(),
              },
            };
          },
          after: async (user, ctx) => {
            const extras = await signupExtrasFrom(ctx, { skipNicknameCheck: true });
            if (extras === "none" || !extras.ok) return;
            try {
              await recordSignupConsents(db, user.id, extras.extras, clientIp(ctx?.request?.headers));
            } catch (error) {
              // 동의 기록 없이 회원만 남지 않게 되돌린다 (로그인 방식 · 세션은 아직 만들어지기 전)
              await db.delete(schema.users).where(eq(schema.users.id, user.id));
              throw error;
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const [user] = await db
              .select({ status: schema.users.status })
              .from(schema.users)
              .where(eq(schema.users.id, session.userId));
            if (user?.status !== "active") {
              fail("FORBIDDEN", "ACCOUNT_SUSPENDED", "이용이 정지된 계정입니다. 1:1 문의로 연락해 주세요.");
            }
            if (await isPrivilegedUser(db, session.userId)) {
              const max = new Date(Date.now() + SESSION_POLICY.privilegedMaxAgeMs);
              if (session.expiresAt > max) return { data: { ...session, expiresAt: max } };
            }
          },
        },
        update: {
          // 라이브러리는 세션을 쓰면 만료일을 30일 뒤로 늘린다. 운영자 · 강사 세션은 만든 때부터 12시간을 넘지 않게 자른다.
          before: async (data, ctx) => {
            if (!data.expiresAt || !ctx) return;
            const token = await ctx.getSignedCookie(
              ctx.context.authCookies.sessionToken.name,
              ctx.context.secret,
            );
            if (!token) return;
            const [session] = await db
              .select({ userId: schema.sessions.userId, createdAt: schema.sessions.createdAt })
              .from(schema.sessions)
              .where(eq(schema.sessions.token, token));
            if (!session || !(await isPrivilegedUser(db, session.userId))) return;
            const max = new Date(session.createdAt.getTime() + SESSION_POLICY.privilegedMaxAgeMs);
            if (data.expiresAt > max) return { data: { ...data, expiresAt: max } };
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        switch (ctx.path) {
          case "/sign-up/email": {
            const body = ctx.body as Record<string, unknown>;
            const extras = await validateSignupExtras(db, {
              nickname: body.name,
              age14: body.age14,
              consents: body.consents,
            });
            if (!extras.ok) fail("BAD_REQUEST", extras.problem.code, extras.problem.message);
            assertPasswordAllowed(body.password, {
              email: typeof body.email === "string" ? body.email : null,
              nickname: extras.extras.nickname,
            });
            return;
          }
          case "/sign-in/email": {
            const email = (ctx.body as { email?: unknown }).email;
            if (typeof email !== "string") return;
            const idHash = identifierHash(env.BETTER_AUTH_SECRET, email);
            const failures = await recentFailures(
              db,
              { identifierHash: idHash },
              ["fail_password"],
              LOGIN_LOCKOUT.windowMs + LOGIN_LOCKOUT.lockMs,
            );
            const until = lockedUntil(failures, new Date());
            if (until) {
              await recordLogin(db, {
                userId: null,
                identifierHash: idHash,
                method: "email",
                result: "blocked_locked",
                headers: ctx.request?.headers,
              });
              fail(
                "TOO_MANY_REQUESTS",
                "ACCOUNT_LOCKED",
                `비밀번호를 여러 번 틀려 잠시 막아 두었습니다. ${minutesUntil(until)}분 뒤에 다시 시도해 주세요.`,
              );
            }
            return;
          }
          case "/reset-password":
            assertPasswordAllowed((ctx.body as { newPassword?: unknown }).newPassword, {});
            return;
          case "/change-password": {
            const session = await getSessionFromCtx(ctx);
            assertPasswordAllowed((ctx.body as { newPassword?: unknown }).newPassword, {
              email: session?.user.email,
              nickname: session?.user.name,
            });
            return;
          }
          case "/two-factor/enable":
          case "/two-factor/disable":
          case "/two-factor/get-totp-uri":
          case "/two-factor/generate-backup-codes": {
            // 비밀번호가 있으면 라이브러리가 비밀번호를 확인한다. 없으면(구글 · 카카오만) 로그인한 지 15분 안이어야 한다
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const [credential] = await db
              .select({ password: schema.authAccounts.password })
              .from(schema.authAccounts)
              .where(
                and(
                  eq(schema.authAccounts.userId, session.user.id),
                  eq(schema.authAccounts.providerId, "credential"),
                ),
              );
            if (credential?.password) return;
            if (Date.now() - session.session.createdAt.getTime() > SESSION_POLICY.recentLoginMs) {
              fail("FORBIDDEN", "RELOGIN_REQUIRED", "본인 확인을 위해 다시 로그인한 뒤 해 주세요.");
            }
            return;
          }
          case "/two-factor/verify-totp":
          case "/two-factor/verify-backup-code": {
            // "이 기기 기억하기"는 쓰지 않는다: 운영자 · 강사는 로그인할 때마다 OTP 를 받는다
            const body = { ...(ctx.body as Record<string, unknown>), trustDevice: false };
            // 로그인 중 다시 확인(관리자 화면 진입)할 때는 라이브러리가 횟수를 세지 않아 여기서 센다
            const session = await getSessionFromCtx(ctx);
            if (!session) return { context: { body } };
            const failures = await recentFailures(
              db,
              { userId: session.user.id, method: "two_factor" },
              ["fail_two_factor"],
              STEP_UP_LOCKOUT.windowMs + STEP_UP_LOCKOUT.lockMs,
            );
            const until = lockedUntil(failures, new Date(), STEP_UP_LOCKOUT);
            if (until) {
              fail(
                "TOO_MANY_REQUESTS",
                "TWO_FACTOR_LOCKED",
                `인증 코드를 여러 번 틀렸습니다. ${minutesUntil(until)}분 뒤에 다시 시도해 주세요.`,
              );
            }
            return { context: { body } };
          }
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        const failed = returned instanceof APIError;
        const headers = ctx.request?.headers;
        switch (ctx.path) {
          case "/sign-in/email": {
            const email = (ctx.body as { email?: unknown }).email;
            if (typeof email !== "string") return;
            const idHash = identifierHash(env.BETTER_AUTH_SECRET, email);
            if (failed) {
              const code = (returned.body as { code?: string } | undefined)?.code;
              const result =
                code === "EMAIL_NOT_VERIFIED"
                  ? "fail_unverified"
                  : code === "ACCOUNT_SUSPENDED"
                    ? "fail_suspended"
                    : "fail_password";
              await recordLogin(db, {
                userId: null,
                identifierHash: idHash,
                method: "email",
                result,
                headers,
              });
              return;
            }
            const newSession = ctx.context.newSession;
            if (newSession) {
              // 이 훅은 2단계 인증 플러그인보다 먼저 돈다. 2단계 인증을 켠 회원이면 플러그인이 이 세션을 지우고
              // OTP 를 요구한다 (기기 기억하기는 쓰지 않는다). 비밀번호는 맞았으므로 잠금 횟수는 여기서 끊긴다.
              const twoFactor = (newSession.user as { twoFactorEnabled?: boolean }).twoFactorEnabled === true;
              await recordLogin(db, {
                userId: newSession.user.id,
                identifierHash: idHash,
                method: "email",
                result: twoFactor ? "two_factor_required" : "success",
                headers,
              });
            }
            return;
          }
          case "/two-factor/verify-totp":
          case "/two-factor/verify-backup-code": {
            if (failed) {
              const session = await getSessionFromCtx(ctx).catch(() => null);
              await recordLogin(db, {
                userId: session?.user.id ?? (await pendingTwoFactorUserId(ctx)),
                method: "two_factor",
                result: "fail_two_factor",
                headers,
              });
              return;
            }
            // 이 세션은 OTP 를 통과했다 ➔ 관리자 · 강사 화면에 들어갈 수 있다
            const tokens = [
              ctx.context.newSession?.session.token,
              (returned as { token?: string } | undefined)?.token,
            ].filter((t): t is string => !!t);
            for (const token of tokens) {
              await db
                .update(schema.sessions)
                .set({ mfaVerifiedAt: new Date() })
                .where(eq(schema.sessions.token, token));
            }
            const userId =
              ctx.context.newSession?.user.id ??
              (returned as { user?: { id?: string } } | undefined)?.user?.id;
            await recordLogin(db, {
              userId: userId ?? null,
              method: "two_factor",
              result: "success",
              headers,
            });
            return;
          }
          case "/callback/:id": {
            const newSession = ctx.context.newSession;
            if (newSession) {
              await recordLogin(db, {
                userId: newSession.user.id,
                method: String(ctx.params?.id ?? "social"),
                result: "success",
                headers,
              });
            }
            return;
          }
          case "/change-password": {
            const session = ctx.context.newSession ?? (await getSessionFromCtx(ctx).catch(() => null));
            if (!failed && session) {
              await enqueueMail({
                template: "password-changed",
                to: session.user.email,
                userId: session.user.id,
              });
            }
            return;
          }
        }
      }),
    },
  });

  /**
   * 가입 때 함께 받은 값(닉네임 · 동의 · 만 14세)을 꺼낸다.
   * 이메일 가입은 요청 본문, 구글 · 카카오는 가입 화면이 OAuth state 에 넣어 보낸 값.
   */
  async function signupExtrasFrom(
    ctx: { path?: string; body?: unknown } | null,
    options: { skipNicknameCheck?: boolean } = {},
  ) {
    if (!ctx?.path) return "none" as const;
    let input: unknown;
    if (ctx.path === "/sign-up/email") {
      const body = ctx.body as Record<string, unknown>;
      input = { nickname: body.name, age14: body.age14, consents: body.consents };
    } else if (ctx.path.startsWith("/callback/")) {
      const state = (await getOAuthState()) as { signup?: unknown } | null;
      input = state?.signup;
    } else {
      return "none" as const;
    }
    if (options.skipNicknameCheck) {
      // after 단계: 방금 만든 회원이 그 닉네임을 쓰고 있으므로 중복 확인은 건너뛴다
      const parsed = signupExtrasSchema.safeParse(input);
      return parsed.success
        ? { ok: true as const, extras: parsed.data }
        : { ok: false as const, problem: { code: "INVALID_SIGNUP_INPUT", message: "" } };
    }
    return validateSignupExtras(db, input);
  }

  return auth;
}

/** 로그인 도중(비밀번호 다음, OTP 전)인 사람. 2단계 인증 플러그인이 남긴 서명 쿠키 ➔ verifications 에서 찾는다 */
async function pendingTwoFactorUserId(ctx: AuthMiddlewareContext): Promise<string | null> {
  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;
  const verification = await ctx.context.internalAdapter.findVerificationValue(identifier).catch(() => null);
  return verification?.value ?? null;
}

type AuthMiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function assertPasswordAllowed(
  password: unknown,
  context: { email?: string | null; nickname?: string | null },
) {
  if (typeof password !== "string") return; // 형식 오류는 Better Auth 가 처리한다
  const problem = checkPassword(password, context);
  if (problem) fail("BAD_REQUEST", "WEAK_PASSWORD", PASSWORD_MESSAGES[problem]);
}

export type Auth = ReturnType<typeof createAuth>;
