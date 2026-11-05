// 자체 서버 영상 (docs/기술설계.md 5.2): 재생 토큰 · HLS 키 암호화 보관 · 자막 변환 · 화질 단계.
// node:crypto 를 쓰므로 서버(web · worker)에서만 부른다 — 화면 코드가 가져오는 "@aionit/core" 에는 넣지 않는다.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** pg-boss 대기열 이름: 올린 영상 변환 (web 이 넣고 worker 가 처리) */
export const VIDEO_QUEUE = "video.transcode";
/**
 * 변환은 오래 걸린다 (1시간 영상 ≈ 수십 분): 6시간 안에 끝나지 않으면 멈춘 것으로 본다.
 * worker 를 내리면 변환을 멈추고 작업을 실패로 돌려 1분 뒤 다시 시작한다 (2번까지).
 * web 과 worker 가 같은 값으로 대기열을 만든다.
 */
export const VIDEO_QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 60,
  expireInSeconds: 6 * 3600,
  deleteAfterSeconds: 7 * 86400,
} as const;

/** 영상 전용 버킷 안 경로. 화면은 /media/<이 경로> 로 받는다 (Caddy 가 토큰 확인 후 Garage 에서) */
export const mediaPaths = (assetId: string) => ({
  root: `v/${assetId}/`,
  hls: `v/${assetId}/hls/`,
  master: `v/${assetId}/hls/master.m3u8`,
  subtitle: (lang: string) => `v/${assetId}/subs/${lang}.vtt`,
});

/** 키 서버 주소 (재생 목록의 EXT-X-KEY URI) */
export const hlsKeyUrl = (assetId: string) => `/api/v1/hls/keys/${assetId}`;

/** 앱 비밀값(BETTER_AUTH_SECRET)에서 쓰임마다 다른 키를 뽑는다. 쓰임 이름이 다르면 서로의 키를 알아낼 수 없다 */
export function deriveKey(secret: string, purpose: string): Buffer {
  if (secret.length < 32) throw new Error("앱 비밀값은 32자 이상이어야 합니다");
  return Buffer.from(hkdfSync("sha256", secret, "aionit", purpose, 32));
}

// ---- 재생 토큰 ----

/** 재생 토큰 유효 시간. 화면이 4분마다 새로 받는다 */
export const MEDIA_TOKEN_TTL_SEC = 5 * 60;
/** 재생 토큰을 실어 보내는 요청 머리글 (주소에 넣지 않아 기록 · 공유 주소에 남지 않는다) */
export const MEDIA_TOKEN_HEADER = "x-media-token";

export interface MediaTokenClaims {
  userId: string;
  assetId: string;
  expiresAt: Date;
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export function signMediaToken(secret: string, claims: MediaTokenClaims): string {
  const payload = b64(
    JSON.stringify({ u: claims.userId, a: claims.assetId, e: Math.floor(claims.expiresAt.getTime() / 1000) }),
  );
  const sig = createHmac("sha256", deriveKey(secret, "media-token/v1")).update(`v1.${payload}`).digest();
  return `v1.${payload}.${b64(sig)}`;
}

/** 서명이 맞고 만료 전이면 내용, 아니면 null */
export function verifyMediaToken(
  secret: string,
  token: string | null | undefined,
  now = new Date(),
): MediaTokenClaims | null {
  if (!token || token.length > 512) return null;
  const [version, payload, sig] = token.split(".");
  if (version !== "v1" || !payload || !sig) return null;
  const expected = createHmac("sha256", deriveKey(secret, "media-token/v1")).update(`v1.${payload}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: unknown;
      a?: unknown;
      e?: unknown;
    };
    if (typeof data.u !== "string" || typeof data.a !== "string" || typeof data.e !== "number") return null;
    if (data.e * 1000 <= now.getTime()) return null;
    return { userId: data.u, assetId: data.a, expiresAt: new Date(data.e * 1000) };
  } catch {
    return null;
  }
}

// ---- HLS 키 보관 (AES-256-GCM, 키 번호를 앞에 붙여 나중에 바꿀 수 있게) ----

export const HLS_KEY_VERSION = 1;

/** 영상 하나의 AES-128 키 (16바이트) 를 DB 에 넣을 수 있게 감싼다: [키 번호 1][iv 12][tag 16][암호문] */
export function sealHlsKey(secret: string, key: Buffer): Buffer {
  if (key.length !== 16) throw new Error("HLS 키는 16바이트여야 합니다");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, `hls-key/v${HLS_KEY_VERSION}`), iv);
  const body = Buffer.concat([cipher.update(key), cipher.final()]);
  return Buffer.concat([Buffer.from([HLS_KEY_VERSION]), iv, cipher.getAuthTag(), body]);
}

export function openHlsKey(secret: string, sealed: Buffer): Buffer {
  const version = sealed[0];
  if (version !== HLS_KEY_VERSION) throw new Error(`모르는 키 번호: ${version}`);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret, `hls-key/v${version}`),
    sealed.subarray(1, 13),
  );
  decipher.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]);
}

// ---- 자막 (srt ➔ WebVTT) ----

const SRT_TIME = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/;

function vttTime(value: string): string | null {
  const m = value.trim().match(SRT_TIME);
  if (!m) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2]}:${m[3]}.${m[4]!.padEnd(3, "0")}`;
}

const escapeCue = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * srt 자막을 WebVTT 로. 글은 그대로 두되 태그는 글자로 바꾼다(자막 안 HTML 을 실행하지 않게).
 * 자막 줄이 하나도 없으면 오류.
 */
export function srtToVtt(srt: string): { vtt: string; cues: number } {
  const blocks = srt
    .replace(/^\s+/, "") // BOM (U+FEFF) · 앞 빈 줄
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/);
  const out: string[] = ["WEBVTT", ""];
  let cues = 0;
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const timeIndex = lines.findIndex((l) => l.includes("-->"));
    if (timeIndex < 0) continue;
    const [start, end] = lines[timeIndex]!.split("-->").map((p) => p.trim().split(/\s+/)[0] ?? "");
    const from = vttTime(start ?? "");
    const to = vttTime(end ?? "");
    const text = lines.slice(timeIndex + 1);
    if (!from || !to || text.length === 0) continue;
    cues += 1;
    out.push(`${from} --> ${to}`, ...text.map(escapeCue), "");
  }
  if (cues === 0) throw new Error("자막 줄을 찾지 못했습니다 (srt 형식을 확인해 주세요)");
  return { vtt: out.join("\n"), cues };
}

// ---- 화질 단계 (강의 영상용 저용량 인코딩, docs/기술설계.md 5.2) ----

export interface Rendition {
  name: string;
  height: number;
  /** 영상 상한 (kbps). 화면 녹화는 대부분 이보다 훨씬 낮게 나온다 */
  maxrateKbps: number;
  /** 품질 기준 (x264 CRF). 상한에 닿지 않으면 이 품질로 */
  crf: number;
}

/** 1080p 약 1 ~ 1.5Mbps 목표. 상한을 두고 CRF 로 품질을 맞춘다 (움직임이 적은 화면은 더 작아진다) */
export const RENDITION_LADDER: readonly Rendition[] = [
  { name: "360p", height: 360, maxrateKbps: 400, crf: 26 },
  { name: "720p", height: 720, maxrateKbps: 900, crf: 24 },
  { name: "1080p", height: 1080, maxrateKbps: 1500, crf: 23 },
];
export const AUDIO_KBPS = 96;
/** 조각 길이 (초) */
export const HLS_SEGMENT_SEC = 6;
/** 초당 장면 수 상한. 화면 녹화 원본이 60fps 여도 30 으로 */
export const MAX_FPS = 30;

/** 원본보다 큰 화질은 만들지 않는다. 원본이 360p 보다 작으면 원본 크기 하나만 */
export function planRenditions(sourceHeight: number): Rendition[] {
  const fit = RENDITION_LADDER.filter((r) => r.height <= sourceHeight + 8);
  if (fit.length > 0) return fit;
  const height = Math.max(2, Math.floor(sourceHeight / 2) * 2);
  return [{ ...RENDITION_LADDER[0]!, name: `${height}p`, height }];
}

/** 워터마크용 회원 번호 일부 (회원 id 끝 6자리) */
export function memberTag(userId: string): string {
  return userId.replaceAll("-", "").slice(-6).toUpperCase();
}

// ---- 자동결제 키(빌링키) 보관 (docs/기술설계.md 3.3: 자동결제 키는 AES-256-GCM 앱 암호화, 키 번호를 함께) ----

export const BILLING_KEY_VERSION = 1;

/** 빌링키 ➔ "v1.<iv>.<tag>.<암호문>" (base64url). DB 가 유출돼도 결제에 쓸 수 없다 */
export function sealBillingKey(secret: string, billingKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, `billing-key/v${BILLING_KEY_VERSION}`), iv);
  const body = Buffer.concat([cipher.update(billingKey, "utf8"), cipher.final()]);
  return [`v${BILLING_KEY_VERSION}`, iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function openBillingKey(secret: string, sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== `v${BILLING_KEY_VERSION}` || !iv || !tag || !body) throw new Error("모르는 빌링키 형식");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret, `billing-key/v${BILLING_KEY_VERSION}`),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

// ---- 개인정보 필드 감싸기 (docs/데이터모델.md 1장: 주민등록번호 · 계좌번호는 앱에서 AES-256-GCM) ----

export const PII_KEY_VERSION = 1;

/** 쓰임(purpose)마다 다른 키로 감싼다. "v1.<iv>.<tag>.<암호문>" (base64url) */
export function sealPii(secret: string, purpose: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, `pii/${purpose}/v${PII_KEY_VERSION}`), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [`v${PII_KEY_VERSION}`, iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function openPii(secret: string, purpose: string, sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== `v${PII_KEY_VERSION}` || !iv || !tag || !body) throw new Error("모르는 암호문 형식");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret, `pii/${purpose}/v${PII_KEY_VERSION}`),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
