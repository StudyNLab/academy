import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// 화면마다 새 nonce 로 CSP 를 건다 (docs/기술설계.md 3.3). Next.js 는 이 nonce 를 자기 스크립트에 붙인다.
// - 스크립트: 우리 도메인 + nonce 만 ('strict-dynamic')
// - 스타일: React 의 style 속성(진도 막대 폭 등) 때문에 'unsafe-inline' 을 둔다. 스크립트는 막혀 있어 위험이 작다
// - frame: 유튜브(M2) · 토스(M5) 가 생기면 그때 더한다
// - frame-ancestors 'none': 다른 사이트가 우리 화면을 틀 안에 넣지 못하게 (클릭재킹)
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
