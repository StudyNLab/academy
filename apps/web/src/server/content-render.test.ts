import { describe, expect, it } from "vitest";
import {
  insertSelfCheckSlots,
  keepSections,
  renderVideoSlots,
  textLength,
  withMainVideo,
  youtubeEmbed,
} from "./content-render";
import { parseYoutubeId } from "./courses";

const html = `<header class="cover"><h1>제목</h1></header>
<section class="goals"><p>목표</p></section>
<section class="sec" id="sec-1"><h2 id="sec-1-0">하나</h2><div class="video-slot" data-video="ch01_lab01" data-kind="lab"><p class="video-title">실습 시연</p></div></section>
<section class="sec" id="sec-2"><h2 id="sec-2-0">둘</h2><p>비밀 내용</p></section>`;

describe("renderVideoSlots", () => {
  const slots = new Map([
    [
      "ch01_lab01",
      { key: "ch01_lab01", title: "실습 시연", source: "youtube" as const, youtubeVideoId: "dQw4w9WgXcQ" },
    ],
  ]);

  it("유튜브가 연결된 자리는 플레이어로", () => {
    const out = renderVideoSlots(html, slots, "public");
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"');
    expect(out).not.toContain("video-slot");
  });

  it("연결 안 된 자리는 수강생에게 안 보이고, 운영자에게는 '영상 연결 필요'", () => {
    expect(renderVideoSlots(html, new Map(), "public")).not.toMatch(/video|실습 시연/);
    expect(renderVideoSlots(html, new Map(), "admin")).toContain("영상 연결 필요");
  });

  it("제목은 이스케이프한다", () => {
    expect(youtubeEmbed("abcdefghijk", '"><script>')).not.toContain("<script>");
  });
});

describe("keepSections (무료 미리보기)", () => {
  it("표지 · 학습 목표 + 고른 Section 만 남긴다", () => {
    const out = keepSections(html, ["sec-1"]);
    expect(out).toContain("제목");
    expect(out).toContain("목표");
    expect(out).toContain('id="sec-1"');
    expect(out).not.toContain("비밀 내용");
  });

  it("아무것도 안 고르면 머리 부분만", () => {
    expect(keepSections(html, [])).not.toContain("sec-1");
  });
});

describe("parseYoutubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://evil.example/watch?v=dQw4w9WgXcQ", null],
    ["https://www.youtube.com/watch?v=<script>", null],
    ["javascript:alert(1)", null],
  ])("%s ➔ %s", (input, expected) => {
    expect(parseYoutubeId(input)).toBe(expected);
  });
});

describe("withMainVideo (챕터 영상은 맨 위)", () => {
  const main = {
    key: "ch01_main",
    title: "CHAPTER 1 강의",
    source: "youtube" as const,
    youtubeVideoId: "dQw4w9WgXcQ",
  };
  it("연결된 챕터 영상을 본문 앞에", () => {
    const out = withMainVideo("<p>본문</p>", main, "public");
    expect(out.indexOf("youtube-nocookie")).toBeLessThan(out.indexOf("본문"));
  });
  it("연결 안 됐으면 수강생에게 없음, 운영자에게 안내", () => {
    const none = { ...main, source: "none" as const, youtubeVideoId: null };
    expect(withMainVideo("<p>본문</p>", none, "public")).toBe("<p>본문</p>");
    expect(withMainVideo("<p>본문</p>", none, "admin")).toContain("영상 연결 필요");
  });
});

describe("학습 화면용", () => {
  it("실습 Section 끝(안쪽 section 이 있어도)에 스스로 확인 자리를 넣는다", () => {
    const body = `<section id="sec-1"><p>a</p></section><section id="sec-2"><section id="sec-2-1"><p>b</p></section><p>c</p></section>`;
    expect(insertSelfCheckSlots(body, ["sec-2"])).toBe(
      `<section id="sec-1"><p>a</p></section><section id="sec-2"><section id="sec-2-1"><p>b</p></section><p>c</p><div class="self-check-slot" data-section="sec-2"></div></section>`,
    );
    expect(insertSelfCheckSlots(body, [])).toBe(body);
  });

  it("영상에 시청 기록 API · 이어 보기 위치를 붙인다", () => {
    const embed = youtubeEmbed("abc", "제목", {
      origin: "https://aionit.kr",
      key: "ch01_main",
      startAt: { ch01_main: 75.6 },
    });
    expect(embed).toContain('data-video-key="ch01_main"');
    expect(embed).toContain("enablejsapi=1&origin=https%3A%2F%2Faionit.kr&start=75");
    expect(youtubeEmbed("abc", "제목")).not.toContain("enablejsapi");
  });

  it("글 분량은 태그 · 줄번호 · 공백을 뺀다", () => {
    expect(textLength('<p>가 나</p><pre><span class="ln">12</span>code</pre>')).toBe(6);
  });
});
