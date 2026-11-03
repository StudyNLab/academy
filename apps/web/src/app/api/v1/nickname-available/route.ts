import { checkNickname, NICKNAME_MESSAGES, normalizeNickname } from "@aionit/core";
import { json, route } from "@/server/api";
import { isNicknameTaken } from "@/server/consents";
import { getDb } from "@/server/db";

// 가입 · 내 정보 화면에서 닉네임을 바로 확인한다. 닉네임은 공개 정보라 로그인 없이 쓴다.
export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const nickname = normalizeNickname(new URL(request.url).searchParams.get("nickname") ?? "");
  const problem = checkNickname(nickname);
  if (problem) return json({ available: false, message: NICKNAME_MESSAGES[problem] });
  if (await isNicknameTaken(getDb(), nickname))
    return json({ available: false, message: NICKNAME_MESSAGES.taken });
  return json({ available: true });
});
