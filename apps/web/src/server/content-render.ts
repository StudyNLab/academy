// 정리해 저장한 교재 본문(chapters.content_html)을 화면용으로 바꾼다. 입력은 이미 허용 목록으로 정리된 HTML 이다.

export interface SlotView {
  key: string;
  title: string;
  source: "none" | "youtube" | "hosted";
  youtubeVideoId: string | null;
}

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** 유튜브 플레이어 (쿠키를 덜 쓰는 youtube-nocookie 주소) */
export function youtubeEmbed(videoId: string, title: string): string {
  return `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0" title="${escapeHtml(title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
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
): string {
  return html.replace(SLOT, (_whole, attrs: string) => {
    const key = attrs.match(/data-video="([a-z0-9_]+)"/)?.[1] ?? "";
    const slot = slots.get(key);
    const title = slot?.title ?? key;
    if (slot?.source === "youtube" && slot.youtubeVideoId) {
      return `<figure class="video-block">${youtubeEmbed(slot.youtubeVideoId, title)}<figcaption>${escapeHtml(title)} · 무료 공개</figcaption></figure>`;
    }
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
