// 정리해 저장한 교재 본문(chapters.content_html)을 화면용으로 바꾼다. 입력은 이미 허용 목록으로 정리된 HTML 이다.

export interface SlotView {
  key: string;
  title: string;
  source: "none" | "youtube" | "hosted";
  youtubeVideoId: string | null;
  /** 자체 서버 영상의 변환이 끝났나 (끝나지 않았으면 연결 안 된 자리처럼 다룬다) */
  hostedReady?: boolean;
}

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** 학습 화면: 시청 기록을 남기도록 플레이어 API 를 켠다 (enablejsapi, origin = 우리 사이트) */
export interface TrackOptions {
  origin: string;
  /** 영상 key ➔ 이어서 볼 위치(초) */
  startAt?: Record<string, number>;
}

/** 유튜브 플레이어 (쿠키를 덜 쓰는 youtube-nocookie 주소) */
export function youtubeEmbed(videoId: string, title: string, track?: TrackOptions & { key: string }): string {
  const start = track?.startAt?.[track.key];
  const query = track
    ? `rel=0&enablejsapi=1&origin=${encodeURIComponent(track.origin)}${start ? `&start=${Math.floor(start)}` : ""}`
    : "rel=0";
  const data = track ? ` data-video-key="${escapeHtml(track.key)}"` : "";
  return `<div class="video-embed"><iframe${data} src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${query}" title="${escapeHtml(title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
}

/**
 * 연결된 영상 하나. 없거나 아직 볼 수 없으면 null.
 *   유튜브: 누구나 재생 (학습 화면이면 시청 기록용 API 를 켠다)
 *   자체 서버(수강생 전용): 학습 화면(track 있음)은 플레이어 자리 ➔ 화면(HostedVideo)이 토큰을 받아 재생,
 *     미리보기(track 없음)는 잠금 카드, 운영자 미리보기는 "연결됨" 안내
 */
function videoFigure(
  slot: SlotView,
  mode: "public" | "admin",
  track?: TrackOptions,
  label = "",
): string | null {
  const key = escapeHtml(slot.key);
  const title = escapeHtml(slot.title);
  if (slot.source === "youtube" && slot.youtubeVideoId) {
    return `<figure class="video-block" id="video-${key}">${youtubeEmbed(slot.youtubeVideoId, slot.title, track && { ...track, key: slot.key })}<figcaption>${title} · 무료 공개</figcaption></figure>`;
  }
  if (slot.source === "hosted" && slot.hostedReady) {
    if (mode === "admin")
      return `<p class="video-hosted-note">자체 서버 영상 연결됨 · <code>${key}</code> ${title}${label} — 수강생 학습 화면에서 재생됩니다</p>`;
    if (!track)
      return `<figure class="video-block" id="video-${key}"><div class="video-locked"><p>수강생 전용 영상입니다</p></div><figcaption>${title}</figcaption></figure>`;
    return `<figure class="video-block" id="video-${key}"><div class="hosted-video" data-hosted-key="${key}"></div><figcaption>${title} · 수강생 전용</figcaption></figure>`;
  }
  return null;
}

const SLOT = /<div class="video-slot"([^>]*)>([\s\S]*?)<\/div>/g;

/**
 * 본문 안 영상 자리 ➔ 연결된 영상. 연결 안 된 자리는 수강생 화면에서 지우고(규격 3.4),
 * 운영자 미리보기에서는 "영상 연결 필요"로 보인다.
 */
export function renderVideoSlots(
  html: string,
  slots: Map<string, SlotView>,
  mode: "public" | "admin",
  track?: TrackOptions,
): string {
  return html.replace(SLOT, (_whole, attrs: string) => {
    const key = attrs.match(/data-video="([a-z0-9_]+)"/)?.[1] ?? "";
    const slot = slots.get(key);
    const title = slot?.title ?? key;
    const figure = slot ? videoFigure(slot, mode, track) : null;
    if (figure) return figure;
    if (mode === "admin") {
      return `<p class="video-missing">영상 연결 필요 · <code>${escapeHtml(key)}</code> ${escapeHtml(title)}</p>`;
    }
    return "";
  });
}

/**
 * 무료 미리보기의 Section 만 남긴다. 표지(header) · 학습 목표 같은 머리 부분과, 고른 id 의 최상위 section 만.
 * 정리된 HTML 이라 section 열고 닫기가 짝이 맞는다.
 */
export function keepSections(html: string, sectionIds: string[]): string {
  const wanted = new Set(sectionIds);
  const out: string[] = [];
  let index = 0;
  let firstSectionSeen = false;
  const tag = /<(\/?)section\b([^>]*)>/g;
  let depth = 0;
  let start = -1;
  let currentId: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    const closing = match[1] === "/";
    if (!closing) {
      if (depth === 0) {
        // section 앞의 머리 부분(표지 등)은 첫 Section 앞까지만 남긴다
        if (!firstSectionSeen) out.push(html.slice(index, match.index));
        firstSectionSeen = true;
        start = match.index;
        currentId = match[2]!.match(/\bid="([^"]+)"/)?.[1] ?? null;
        // id 가 없는 머리 section(학습 목표 goals 등)은 남긴다
        if (!currentId && /class="[^"]*\bgoals\b/.test(match[2]!)) currentId = "__keep__";
      }
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        const end = match.index + match[0].length;
        if (currentId === "__keep__" || (currentId && wanted.has(currentId)))
          out.push(html.slice(start, end));
        index = end;
      }
    }
  }
  if (!firstSectionSeen) return html;
  return out.join("\n");
}

/**
 * 챕터 영상(main)은 본문 맨 위에 둔다 (Q1: 챕터 영상 ➔ 교재). 본문 안에는 자리가 없고 manifest 에만 있다.
 * 연결 안 됐으면 수강생에게는 없음, 운영자에게는 "영상 연결 필요".
 */
export function withMainVideo(
  html: string,
  main: SlotView | undefined,
  mode: "public" | "admin",
  track?: TrackOptions,
): string {
  if (!main) return html;
  const figure = videoFigure(main, mode, track, " (챕터 영상)");
  if (figure) return `${figure}\n${html}`;
  if (mode === "admin") {
    return `<p class="video-missing">영상 연결 필요 · <code>${escapeHtml(main.key)}</code> ${escapeHtml(main.title)} (챕터 영상)</p>\n${html}`;
  }
  return html;
}

/**
 * 실습 Section 끝에 "스스로 확인" 자리를 넣는다. 화면(Reader)이 이 자리에 체크 목록을 그린다.
 * 정리된 HTML 이라 section 열고 닫기가 짝이 맞는다.
 */
export function insertSelfCheckSlots(html: string, sectionIds: readonly string[]): string {
  if (sectionIds.length === 0) return html;
  const wanted = new Set(sectionIds);
  const tag = /<(\/?)section\b([^>]*)>/g;
  const stack: (string | null)[] = [];
  const inserts: { at: number; id: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    if (match[1] !== "/") {
      stack.push(match[2]!.match(/\bid="([^"]+)"/)?.[1] ?? null);
    } else {
      const id = stack.pop();
      if (id && wanted.has(id)) inserts.push({ at: match.index, id });
    }
  }
  let out = html;
  for (const { at, id } of inserts.sort((a, b) => b.at - a.at)) {
    out = `${out.slice(0, at)}<div class="self-check-slot" data-section="${escapeHtml(id)}"></div>${out.slice(at)}`;
  }
  return out;
}

/** 글 분량 (교재 완료 최소 시간 계산용): 태그 · 코드 줄번호를 뺀 글자 수 */
export function textLength(html: string): number {
  return html
    .replace(/<span class="ln"[^>]*>[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, "").length;
}
