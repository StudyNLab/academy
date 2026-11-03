import "server-only";
import { z } from "zod";

// 환경변수는 처음 쓸 때 한 번 검사한다 (docs/기술설계.md 2.1: 바깥 입력은 zod 로).
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** 세션 쿠키 서명 · 2단계 인증 비밀값 암호화 · 로그인 기록 해시에 쓴다. 32자 이상 */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** 사용자가 브라우저로 여는 주소 (메일 링크 · 로그인 돌아올 주소 · Origin 확인 기준) */
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  KAKAO_CLIENT_ID: z.string().optional(),
  KAKAO_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      // 값은 찍지 않는다 (비밀값이 섞여 있다). 어느 이름이 문제인지만.
      const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`환경변수가 비었거나 형식이 틀렸습니다: ${names}`);
    }
    cached = parsed.data;
  }
  return cached;
}
