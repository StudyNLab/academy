// 브라우저에서 API 를 부르는 도우미. 쓰기는 모두 /api/v1 (인증은 /api/v1/auth) 로 한다.

export interface ApiFailure {
  code: string;
  message: string;
  status: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

/** 인증 라이브러리의 오류 코드 ➔ 쉬운 말 */
const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "이메일 또는 비밀번호가 맞지 않습니다.",
  EMAIL_NOT_VERIFIED: "이메일 인증이 끝나지 않았습니다. 인증 메일을 다시 보냈으니 메일함을 확인해 주세요.",
  INVALID_EMAIL: "이메일 주소 형식이 맞지 않습니다.",
  PASSWORD_TOO_SHORT: "비밀번호는 8자 이상이어야 합니다.",
  PASSWORD_TOO_LONG: "비밀번호는 128자까지 쓸 수 있습니다.",
  INVALID_TOKEN: "링크가 만료되었거나 이미 쓴 링크입니다. 다시 요청해 주세요.",
  INVALID_CODE: "인증 코드가 맞지 않습니다.",
  INVALID_BACKUP_CODE: "복구 코드가 맞지 않습니다.",
  INVALID_TWO_FACTOR_COOKIE: "인증 시간이 지났습니다. 처음부터 다시 로그인해 주세요.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "인증 코드를 여러 번 틀렸습니다. 처음부터 다시 로그인해 주세요.",
  INVALID_PASSWORD: "비밀번호가 맞지 않습니다.",
  FAILED_TO_UNLINK_LAST_ACCOUNT: "로그인 방식이 하나뿐이라 연결을 끊을 수 없습니다.",
  SOCIAL_ACCOUNT_ALREADY_LINKED: "이미 다른 회원에게 연결된 계정입니다.",
  EMAIL_DOES_NOT_MATCH: "가입한 이메일과 같은 이메일의 계정만 연결할 수 있습니다.",
};

async function post<T>(url: string, body: unknown, method = "POST"): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      ...(body instanceof FormData
        ? { body }
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }),
      credentials: "same-origin",
    });
  } catch {
    return {
      ok: false,
      error: { code: "NETWORK", message: "인터넷 연결을 확인하고 다시 시도해 주세요.", status: 0 },
    };
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> | null;
  if (response.ok) return { ok: true, data: (data ?? {}) as T };
  // /api/v1 은 { error: { code, message } }, 인증 API 는 { code, message }
  const raw = ((data?.error as Record<string, unknown> | undefined) ?? data ?? {}) as {
    code?: string;
    message?: string;
  };
  const code = raw.code ?? (response.status === 429 ? "RATE_LIMITED" : "UNKNOWN");
  const message =
    AUTH_MESSAGES[code] ??
    (response.status === 429 && !raw.message?.match(/[가-힣]/)
      ? "요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요."
      : raw.message && /[가-힣]/.test(raw.message)
        ? raw.message
        : "잠시 뒤 다시 시도해 주세요.");
  return { ok: false, error: { code, message, status: response.status } };
}

export const authApi = <T = Record<string, unknown>>(path: string, body?: unknown) =>
  post<T>(`/api/v1/auth${path}`, body);

/** 쓰기 요청. body 가 FormData 면 파일 올리기(multipart) */
export const api = <T = Record<string, unknown>>(path: string, body?: unknown) =>
  post<T>(`/api/v1${path}`, body);

export const apiDelete = <T = Record<string, unknown>>(path: string) =>
  post<T>(`/api/v1${path}`, undefined, "DELETE");

/** 구글 · 카카오로 이동. 가입 화면은 동의 · 닉네임을 함께 보낸다 */
export async function startSocial(
  provider: "google" | "kakao",
  options: { callbackURL: string; errorCallbackURL: string; signup?: unknown; link?: boolean },
): Promise<ApiFailure | null> {
  const result = options.link
    ? await authApi<{ url?: string }>("/link-social", {
        provider,
        callbackURL: options.callbackURL,
        errorCallbackURL: options.errorCallbackURL,
      })
    : await authApi<{ url?: string }>("/sign-in/social", {
        provider,
        callbackURL: options.callbackURL,
        errorCallbackURL: options.errorCallbackURL,
        ...(options.signup ? { requestSignUp: true, additionalData: { signup: options.signup } } : {}),
      });
  if (!result.ok) return result.error;
  if (result.data.url) window.location.assign(result.data.url);
  return null;
}
