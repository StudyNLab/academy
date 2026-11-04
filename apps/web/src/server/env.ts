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
  /** 토스페이먼츠 (테스트 모드). 없으면 결제를 열지 않는다 */
  TOSS_CLIENT_KEY: z.string().optional(),
  TOSS_SECRET_KEY: z.string().optional(),
  /** 토스 자동결제(구독)용 API 개별 연동 키 (M6). 없으면 구독 신청을 열지 않는다 */
  TOSS_BILLING_CLIENT_KEY: z.string().optional(),
  TOSS_BILLING_SECRET_KEY: z.string().optional(),
  /** "1" 이면 개발 서버에서 가짜 결제 (화면 흐름 테스트용, 운영 빌드에서는 무시) */
  TOSS_FAKE: z.string().optional(),
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
