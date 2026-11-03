// 교재 패키지 검사: 정상 패키지 통과, 공격용 패키지(경로 탈출 · 스크립트 · 거대 파일) 거부 (개발계획 M2 완료 기준)
import { describe, expect, it } from "vitest";
import { processPackage, sanitizeChapterHtml } from "../src";
import { buildZip, chapterHtml, courseJson, imageUrl, manifest, normalEntries, png } from "./fixtures";

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

async function withReplaced(name: string, data: string | Buffer) {
  return (await normalEntries()).map((e) => (e.name === name ? { ...e, data } : e));
}

describe("정상 패키지", () => {
  it("통과하고, 챕터 · 목차 · 영상 자리 · 그림을 돌려준다", async () => {
    const result = await processPackage(buildZip(await normalEntries()), {
      imageUrl,
      expectedCourseId: "ai-agent-basics",
    });
    expect(result.report.errors).toEqual([]);
    expect(result.report.ok).toBe(true);
    expect(result.report.course).toEqual({
      id: "ai-agent-basics",
      title: "AI Agent 개발 · 초급",
      version: "0.2.0",
    });
    expect(result.chapters.map((c) => c.key)).toEqual(["ch01", "ch02"]);
    expect(result.chapters[0]!.videos.map((v) => v.key)).toEqual(["ch01_main", "ch01_lab01"]);
    expect(result.images.map((i) => i.path).sort()).toEqual(["images/fig1-01.png", "images/fig2-01.png"]);
    // WebP 로 바뀐다
    expect(result.images[0]!.webp.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // 그림 주소가 플랫폼 주소로 바뀐다
    expect(result.chapters[0]!.contentHtml).toContain('src="/media/test/images/fig1-01.png"');
    expect(result.chapters[0]!.contentHtml).toContain('loading="lazy"');
    // 외부 링크는 새 창 + noopener
    expect(result.chapters[0]!.contentHtml).toContain(
      'href="https://example.com/docs" target="_blank" rel="noopener noreferrer"',
    );
    // 문법 색 class 는 코드 안에서 남는다
    expect(result.chapters[0]!.contentHtml).toContain('<span class="k">import</span>');
  });

  it("규격 밖 파일(.git · 임시 파일)은 무시하고 보고서에 적는다", async () => {
    const entries = [
      ...(await normalEntries()),
      { name: ".git/config", data: "x" },
      { name: "notes.txt", data: "x" },
    ];
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(result.report.ok).toBe(true);
    expect(result.report.skipped).toEqual([".git/config", "notes.txt"]);
  });

  it("이전 공개 버전과 바뀐 챕터를 비교한다", async () => {
    const first = await processPackage(buildZip(await normalEntries()), { imageUrl });
    const previous = first.chapters.map((c) => ({
      key: c.key,
      title: c.title,
      contentSha256: c.contentSha256,
    }));
    previous.push({ key: "ch09", title: "없어질 챕터", contentSha256: "x" });
    const entries = await withReplaced(
      "chapters/02_LLM_API_호출/content.html",
      chapterHtml(2, "<p>보충 설명</p>"),
    );
    const second = await processPackage(buildZip(entries), { imageUrl, previous });
    expect(second.report.diff).toEqual([
      { key: "ch01", title: "챕터 1", change: "same" },
      { key: "ch02", title: "챕터 2", change: "changed" },
      { key: "ch09", title: "없어질 챕터", change: "removed" },
    ]);
  });
});

describe("공격용 패키지 거부", () => {
  it("경로 탈출 (../)", async () => {
    const entries = [...(await normalEntries()), { name: "chapters/../../etc/passwd", data: "root" }];
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(result.report.ok).toBe(false);
    expect(codes(result.report.errors)).toEqual(["ZIP_PATH_TRAVERSAL"]);
    expect(result.chapters).toEqual([]);
  });

  it.each([
    ["절대 경로", "/etc/passwd", "ZIP_BAD_PATH"],
    ["윈도우 드라이브", "C:/Windows/evil.dll", "ZIP_BAD_PATH"],
    ["역슬래시 (..\ 로 탈출)", "..\\..\\evil.txt", "ZIP_PATH_TRAVERSAL"],
  ])("%s", async (_label, name, code) => {
    const entries = [...(await normalEntries()), { name, data: "x" }];
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(codes(result.report.errors)).toEqual([code]);
  });

  it("심볼릭 링크는 따라가지 않는다", async () => {
    const entries = [
      ...(await normalEntries()),
      { name: "images/link.png", data: "/etc/shadow", unixMode: 0o120777, method: 0 as const },
    ];
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(result.report.ok).toBe(true);
    expect(result.report.skipped).toContain("images/link.png (링크)");
  });

  it("스크립트 · 이벤트 속성 · javascript: 링크 · data: 그림 · iframe 은 남지 않는다", async () => {
    const evil = `<script>alert(1)</script><img src="images/fig1-01.png" onerror="alert(2)" width="64" height="40">
<a href="javascript:alert(3)">x</a><img src="data:image/png;base64,AAAA"><iframe src="https://evil.example"></iframe>
<svg><script>alert(4)</script></svg><p style="position:fixed" onclick="x()" class="cover evil">t</p>
<a href="//evil.example">p</a><div class="video-slot" data-video="../x" data-kind="lab"></div><form action="x"><input></form>`;
    const result = sanitizeChapterHtml(evil, (p) => (p === "images/fig1-01.png" ? "/ok.webp" : null));
    expect(result.html).not.toMatch(
      /script|onerror|onclick|javascript:|iframe|svg|style=|data:image|evil|form|input/i,
    );
    expect(result.html).toContain('<p class="cover">t</p>');
    expect(result.removed).toEqual(
      expect.arrayContaining([
        "태그 <script>",
        "onerror 속성 (스크립트)",
        "style 속성",
        'class "evil"',
        "data: 그림 (base64)",
        "태그 <iframe>",
      ]),
    );
  });

  it("본문의 스크립트는 지우고 경고로 남긴다 (패키지는 통과)", async () => {
    const entries = await withReplaced(
      "chapters/01_AI_Agent의_이해/content.html",
      chapterHtml(1, "<script>steal()</script>"),
    );
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(result.report.ok).toBe(true);
    expect(result.chapters[0]!.contentHtml).not.toContain("steal");
    expect(result.report.warnings).toContainEqual(
      expect.objectContaining({ code: "HTML_REMOVED", message: "허용 목록 밖이라 지움: 태그 <script>" }),
    );
  });

  it("거대 파일: 선언 크기가 한도를 넘으면 바로 거부", async () => {
    const entries = [
      ...(await normalEntries()),
      { name: "images/huge.png", data: Buffer.alloc(10), declaredSize: 50 * 1024 * 1024 },
    ];
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(codes(result.report.errors)).toEqual(["ZIP_ENTRY_TOO_LARGE"]);
  });

  it("압축 폭탄: 크기를 작게 속여도 실제로 풀린 양으로 막는다", async () => {
    const bomb = Buffer.alloc(20 * 1024 * 1024); // 0 으로 채운 20MB ➔ 압축하면 20KB 정도
    const entries = [...(await normalEntries()), { name: "images/bomb.png", data: bomb, declaredSize: 1000 }];
    const zip = buildZip(entries);
    expect(zip.length).toBeLessThan(200 * 1024);
    const result = await processPackage(zip, { imageUrl });
    expect(result.report.ok).toBe(false);
    expect(codes(result.report.errors)[0]).toMatch(/ZIP_ENTRY_TOO_LARGE|ZIP_INVALID/);
  });

  it("거대 본문 (content.html 1MB 초과)", async () => {
    const entries = await withReplaced(
      "chapters/01_AI_Agent의_이해/content.html",
      "<p>" + "가".repeat(400_000) + "</p>",
    );
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(codes(result.report.errors)).toEqual(["ZIP_ENTRY_TOO_LARGE"]);
  });

  it("SVG · 확장자만 바꾼 파일은 그림으로 받지 않는다", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const entries = await withReplaced("images/fig1-01.png", svg);
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(result.report.ok).toBe(false);
    expect(codes(result.report.errors)).toEqual(["IMAGE_BAD_FORMAT"]);
  });

  it("zip 이 아닌 파일", async () => {
    const result = await processPackage(Buffer.from("not a zip at all"), { imageUrl });
    expect(codes(result.report.errors)).toEqual(["ZIP_INVALID"]);
  });
});

describe("규격 검사", () => {
  it("다른 과정의 패키지는 받지 않는다", async () => {
    const result = await processPackage(buildZip(await normalEntries()), {
      imageUrl,
      expectedCourseId: "linux-log",
    });
    expect(codes(result.report.errors)).toEqual(["COURSE_ID_MISMATCH"]);
  });

  it("course.json 없음 · 형식 오류 · 규격 버전 다름", async () => {
    const noCourse = (await normalEntries()).filter((e) => e.name !== "course.json");
    expect(codes((await processPackage(buildZip(noCourse), { imageUrl })).report.errors)).toEqual([
      "COURSE_JSON_MISSING",
    ]);
    const bad = await withReplaced(
      "course.json",
      JSON.stringify(courseJson({ schema: "academy-course/9.9", course_id: "Bad ID" })),
    );
    const result = await processPackage(buildZip(bad), { imageUrl });
    expect(new Set(codes(result.report.errors))).toEqual(new Set(["COURSE_JSON_INVALID"]));
    expect(result.report.errors.length).toBe(2);
  });

  it("목차 id 가 본문에 없으면 오류 (읽은 위치가 여기에 묶인다)", async () => {
    const m = manifest(1);
    m.toc.push({ level: 1, id: "sec-9", title: "없는 절", lab: false });
    const entries = await withReplaced("chapters/01_AI_Agent의_이해/manifest.json", JSON.stringify(m));
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(result.report.errors).toEqual([
      expect.objectContaining({ code: "TOC_ID_NOT_IN_HTML", where: "ch01 (01_AI_Agent의_이해)" }),
    ]);
  });

  it("그림 누락 · manifest 에 없는 그림 · 영상 자리 불일치 · key 중복", async () => {
    let entries = (await normalEntries()).filter((e) => e.name !== "images/fig2-01.png");
    const m1 = manifest(1, { images: [] });
    const m2 = manifest(2, {
      videos: [
        { key: "ch01_main", kind: "main", title: "중복" },
        { key: "ch02_lab09", kind: "lab", title: "없는 자리", section_id: "sec-2" },
      ],
    });
    entries = entries.map((e) =>
      e.name === "chapters/01_AI_Agent의_이해/manifest.json"
        ? { ...e, data: JSON.stringify(m1) }
        : e.name === "chapters/02_LLM_API_호출/manifest.json"
          ? { ...e, data: JSON.stringify(m2) }
          : e,
    );
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(new Set(codes(result.report.errors))).toEqual(
      new Set([
        "IMAGE_NOT_IN_MANIFEST",
        "IMAGE_MISSING",
        "VIDEO_KEY_DUPLICATE",
        "VIDEO_SLOT_NOT_IN_HTML",
        "VIDEO_SLOT_NOT_IN_MANIFEST",
      ]),
    );
  });

  it("큰 그림은 줄이고 기준에 가까우면 경고", async () => {
    const big = await png(3000, 2000);
    const entries = await withReplaced("images/fig1-01.png", big);
    const result = await processPackage(buildZip(entries), { imageUrl });
    expect(result.report.ok).toBe(true);
    const fig = result.images.find((i) => i.path === "images/fig1-01.png")!;
    expect(fig.width).toBe(1440);
    expect(fig.height).toBe(960);
  });
});
