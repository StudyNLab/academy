// content.html 정리: 규격 3.5 허용 목록 밖의 태그 · 속성 · class 를 지운다. 스크립트는 남지 않는다.
// 그림 src 는 패키지 경로(images/...) ➔ 플랫폼 주소로 바꾼다. 무엇을 지웠는지 보고서에 남긴다.
import sanitizeHtml from "sanitize-html";
import { ALLOWED_CLASSES, ALLOWED_TAGS, PYGMENTS_CLASS, SECTION_ID, VIDEO_KEY } from "./spec";

export interface SanitizeResult {
  html: string;
  /** 본문에 있는 Section id (section · h2) */
  sectionIds: Set<string>;
  /** 본문이 쓰는 그림 경로 (images/...) */
  imagePaths: Set<string>;
  /** 본문 안 영상 자리 */
  videoSlots: { key: string; kind: string }[];
  /** 지운 것 (중복 없이, 보고서용) */
  removed: string[];
}

const TAGS = new Set<string>(ALLOWED_TAGS);
const CLASSES = new Set<string>(ALLOWED_CLASSES);
const VIDEO_KINDS = new Set(["main", "lab", "extra"]);

export function sanitizeChapterHtml(html: string, imageUrl: (path: string) => string | null): SanitizeResult {
  const removed = new Set<string>();
  const sectionIds = new Set<string>();
  const imagePaths = new Set<string>();
  const videoSlots: { key: string; kind: string }[] = [];
  const stack: string[] = [];

  const clean = sanitizeHtml(html, {
    allowedTags: [...ALLOWED_TAGS],
    disallowedTagsMode: "discard",
    allowedAttributes: {
      "*": ["class"],
      section: ["id", "class"],
      h2: ["id", "class"],
      img: ["src", "alt", "width", "height", "loading", "decoding", "class"],
      a: ["href", "target", "rel", "class"],
      button: ["type", "class"],
      th: ["colspan", "rowspan", "class"],
      td: ["colspan", "rowspan", "class"],
      div: ["data-video", "data-kind", "class"],
      details: ["open", "class"],
    },
    allowedClasses: {
      "*": [...ALLOWED_CLASSES],
      // 문법 색: 코드 안 span 에만
      span: [...ALLOWED_CLASSES, PYGMENTS_CLASS],
    },
    allowedSchemes: ["https"],
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    // 보고서: 정리 전 모습을 보고 무엇이 지워질지 적는다
    onOpenTag: (name, attribs) => {
      stack.push(name);
      if (!TAGS.has(name)) removed.add(`태그 <${name}>`);
      for (const attr of Object.keys(attribs)) {
        if (attr === "style") removed.add("style 속성");
        else if (attr.startsWith("on")) removed.add(`${attr} 속성 (스크립트)`);
      }
      for (const cls of (attribs.class ?? "").split(/\s+/).filter(Boolean)) {
        const inCode = stack.includes("code");
        if (!CLASSES.has(cls) && !(name === "span" && inCode && PYGMENTS_CLASS.test(cls))) {
          removed.add(`class "${cls}"`);
        }
      }
    },
    onCloseTag: () => {
      stack.pop();
    },
    transformTags: {
      section: keepSectionId,
      h2: keepSectionId,
      a: (tagName, attribs) => {
        const href = attribs.href ?? "";
        const next: sanitizeHtml.Attributes = { ...attribs };
        delete next.target;
        delete next.rel;
        if (/^#sec-\d+(-\d+)?$/.test(href)) return { tagName, attribs: next };
        if (/^https:\/\/[^\s"'<>]+$/.test(href)) {
          return { tagName, attribs: { ...next, target: "_blank", rel: "noopener noreferrer" } };
        }
        if (href) removed.add(`링크 주소 "${href.slice(0, 60)}"`);
        delete next.href;
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const src = attribs.src ?? "";
        const url = imageUrl(src);
        if (!url) {
          removed.add(src.startsWith("data:") ? "data: 그림 (base64)" : `그림 "${src.slice(0, 80)}"`);
          // src 가 없는 img 는 아래 exclusiveFilter 가 지운다
          const rest = { ...attribs };
          delete rest.src;
          return { tagName, attribs: rest };
        }
        imagePaths.add(src);
        return { tagName, attribs: { ...attribs, src: url, loading: "lazy", decoding: "async" } };
      },
      button: (tagName, attribs): sanitizeHtml.Tag => {
        const classes = (attribs.class ?? "").split(/\s+/);
        if (attribs.type === "button" && classes.includes("copy")) {
          return { tagName, attribs: { type: "button", class: "copy" } };
        }
        removed.add("button (copy 외)");
        return { tagName: "span", attribs: {} };
      },
      div: (tagName, attribs) => {
        const classes = (attribs.class ?? "").split(/\s+/);
        const next = { ...attribs };
        if (classes.includes("video-slot")) {
          const key = attribs["data-video"] ?? "";
          const kind = attribs["data-kind"] ?? "";
          if (VIDEO_KEY.test(key) && VIDEO_KINDS.has(kind)) {
            videoSlots.push({ key, kind });
            return { tagName, attribs: next };
          }
          removed.add(`영상 자리 "${key}"`);
        }
        delete next["data-video"];
        delete next["data-kind"];
        return { tagName, attribs: next };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  });

  // 정리된 결과에서 id 를 다시 모은다 (보고서 · toc 대조는 실제로 남은 것 기준)
  for (const match of clean.matchAll(/<(?:section|h2)\b[^>]*\bid="([^"]+)"/g)) sectionIds.add(match[1]!);

  return { html: clean, sectionIds, imagePaths, videoSlots, removed: [...removed] };

  function keepSectionId(tagName: string, attribs: sanitizeHtml.Attributes) {
    const next = { ...attribs };
    if (next.id !== undefined && !SECTION_ID.test(next.id)) {
      removed.add(`id "${next.id.slice(0, 40)}"`);
      delete next.id;
    }
    return { tagName, attribs: next };
  }
}
