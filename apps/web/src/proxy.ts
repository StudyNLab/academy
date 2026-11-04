import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// 화면마다 새 nonce 로 CSP 를 건다 (docs/기술설계.md 3.3). Next.js 는 이 nonce 를 자기 스크립트에 붙인다.
// - 스크립트: 우리 도메인 + nonce 만 ('strict-dynamic')
// - 스타일: React 의 style 속성(진도 막대 폭 등) 때문에 'unsafe-inline' 을 둔다. 스크립트는 막혀 있어 위험이 작다
// - media · worker: 자체 서버 영상 (hls.js, M4)
// - frame · connect: 유튜브(교재 영상, 쿠키를 덜 쓰는 youtube-nocookie), 토스페이먼츠 결제창(M5).
//   토스 SDK 스크립트는 우리 스크립트가 넣으므로 'strict-dynamic' 으로 허용된다 (주소 목록을 따로 두지 않는다)
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
    // 자체 서버 영상: hls.js 가 브라우저 안 주소(blob:)로 영상을 붙이고, 변환 작업을 worker(blob:)로 돌린다
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' https://*.tosspayments.com${dev ? " ws:" : ""}`,
    "frame-src https://www.youtube-nocookie.com https://*.tosspayments.com",
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
