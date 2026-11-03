// 시험 패키지 만들기. 공격용 패키지(경로 탈출 · 링크 · 크기 거짓말)도 만들 수 있게 zip 을 직접 쓴다.
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import sharp from "sharp";

export interface ZipEntry {
  name: string;
  data: Buffer | string;
  /** 0 = 그대로, 8 = deflate */
  method?: 0 | 8;
  /** 중앙 디렉터리에 적을 풀린 크기 (거짓말 시험용) */
  declaredSize?: number;
  /** 유닉스 파일 종류 · 권한 (링크 시험: 0o120777) */
  unixMode?: number;
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(raw);
    const size = entry.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 이름
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // 만든 곳: 유닉스
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

export async function png(width = 64, height = 40): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 60, b: 90 } } })
    .png()
    .toBuffer();
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function chapterHtml(n: number, extra = ""): string {
  return `<header class="cover"><p class="label">CHAPTER ${n}</p><h1>챕터 ${n}</h1></header>
<section class="sec" id="sec-1"><h2 id="sec-1-0"><span class="num">1</span> 개념</h2>
<p>본문 <strong>강조</strong> <a href="#sec-2">다음으로</a> <a href="https://example.com/docs">문서</a></p>
<figure class="fig"><img src="images/fig${n}-01.png" alt="그림 ${n}-1" width="64" height="40"><figcaption>그림 ${n}-1</figcaption></figure>
<div class="code run"><div class="code-head"><span class="tag">실행</span><button type="button" class="copy">복사</button></div>
<pre class="hl"><code><span class="k">import</span> <span class="n">os</span></code></pre></div>
<div class="box tip"><p class="box-title">참고</p><p>팁</p></div>
</section>
<section class="sec lab" id="sec-2"><h2 id="sec-2-0">실습 ${n}</h2>
<div class="video-slot" data-video="ch0${n}_lab01" data-kind="lab"><p class="video-title">실습 ${n} 시연</p></div>
<table class="tbl"><thead><tr><th>항목</th></tr></thead><tbody><tr><td colspan="1">값</td></tr></tbody></table>
${extra}</section>`;
}

export function manifest(n: number, overrides: Record<string, unknown> = {}) {
  return {
    schema: "academy-chapter/0.2",
    chapter_id: `ch0${n}`,
    label: `CHAPTER ${n}`,
    title: `챕터 ${n}`,
    source: `0${n}.md`,
    source_sha256: sha(`source ${n}`),
    toc: [
      { level: 1, id: "sec-1", title: "1. 개념", lab: false },
      { level: 1, id: "sec-2", title: `실습 ${n}`, lab: true },
    ],
    images: [{ path: `images/fig${n}-01.png`, alt: `그림 ${n}-1`, width: 64, height: 40 }],
    videos: [
      { key: `ch0${n}_main`, kind: "main", title: `CHAPTER ${n} 강의` },
      { key: `ch0${n}_lab01`, kind: "lab", title: `실습 ${n} 시연`, section_id: "sec-2" },
    ],
    labs: [{ section_id: "sec-2", title: `실습 ${n}`, self_check: [{ id: "c1", text: "결과가 보인다" }] }],
    ...overrides,
  };
}

export function courseJson(overrides: Record<string, unknown> = {}) {
  return {
    schema: "academy-course/0.2",
    course_id: "ai-agent-basics",
    title: "AI Agent 개발 · 초급",
    field: "AI",
    version: "0.2.0",
    built_at: "2026-11-04T10:00:00+09:00",
    generator: "test fixture",
    chapters: [
      { chapter_id: "ch01", dir: "01_AI_Agent의_이해", title: "AI Agent 의 이해" },
      { chapter_id: "ch02", dir: "02_LLM_API_호출", title: "LLM API 호출" },
    ],
    ...overrides,
  };
}

/** 정상 패키지의 항목들. 시험마다 고쳐 쓴다 */
export async function normalEntries(): Promise<ZipEntry[]> {
  const course = courseJson();
  const dirs = ["01_AI_Agent의_이해", "02_LLM_API_호출"];
  const entries: ZipEntry[] = [{ name: "course.json", data: JSON.stringify(course) }];
  for (const [i, dir] of dirs.entries()) {
    const n = i + 1;
    entries.push(
      { name: `chapters/${dir}/content.html`, data: chapterHtml(n) },
      { name: `chapters/${dir}/manifest.json`, data: JSON.stringify(manifest(n)) },
      { name: `chapters/${dir}/source.md`, data: `source ${n}` },
      { name: `images/fig${n}-01.png`, data: await png(64, 39 + n), method: 0 },
    );
  }
  return entries;
}

export const imageUrl = (path: string) => `/media/test/${path}`;
