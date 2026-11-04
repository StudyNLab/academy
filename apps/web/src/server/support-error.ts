// Q&A · 문의 · 알림 · 공지의 오류. API 는 { error: { code, message, details } } 로 돌려준다 (api.ts route)
export class SupportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** 화면이 더 알아야 할 것 (예: API 키처럼 보이는 글자 목록) */
    readonly details?: unknown,
  ) {
    super(message);
  }
}
