import "server-only";
import { getEnv } from "./env";

export type SocialProvider = "google" | "kakao";

/** 앱 등록(키)이 된 소셜 로그인만 화면에 보인다 */
export function socialProviders(): SocialProvider[] {
  const env = getEnv();
  const list: SocialProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) list.push("google");
  if (env.KAKAO_CLIENT_ID && env.KAKAO_CLIENT_SECRET) list.push("kakao");
  return list;
}
