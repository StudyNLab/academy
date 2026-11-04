// 올린 영상 변환 (docs/기술설계.md 5.2): 원본 ➔ ffprobe ➔ ffmpeg 360p · 720p · 1080p HLS (AES-128) ➔ 영상 버킷.
// web 이 대기열(VIDEO_QUEUE)에 넣은 영상을 하나씩 처리한다. 진행 상태는 video_assets.progress 에 적는다.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Rendition } from "@aionit/core/media";
import {
  AUDIO_KBPS,
  HLS_KEY_VERSION,
  HLS_SEGMENT_SEC,
  hlsKeyUrl,
  MAX_FPS,
  mediaPaths,
  planRenditions,
  sealHlsKey,
} from "@aionit/core/media";
import type { Db, VideoRendition } from "@aionit/db";
import { eq, schema } from "@aionit/db";
import type { FileStore } from "@aionit/storage";

export interface VideoDeps {
  db: Db;
  /** 원본이 있는 저장소 (S3_BUCKET) */
  store: FileStore;
  /** 변환 결과를 둘 영상 버킷 (S3_MEDIA_BUCKET) */
  media: FileStore;
  /** HLS 키를 감쌀 앱 비밀값 */
  secret: string;
  ffmpeg?: string;
  ffprobe?: string;
}

export interface Probe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

/** 실행하고 표준 출력을 받는다. 실패하면 표준 오류 끝부분을 담아 오류 */
function run(
  command: string,
  args: string[],
  options: { signal?: AbortSignal; onStdout?: (chunk: string) => void; nice?: boolean } = {},
): Promise<string> {
  // 리눅스 서버에서는 우선순위를 낮춰 web 이 느려지지 않게 한다
  const [cmd, argv] =
    options.nice && process.platform === "linux" ? ["nice", ["-n", "10", command, ...args]] : [command, args];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    const onAbort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (options.onStdout) options.onStdout(chunk);
      else out += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      err = (err + chunk).slice(-4000);
    });
    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (options.signal?.aborted) reject(new AbortedError());
      else if (code === 0) resolve(out);
      else reject(new Error(`${command} 실패 (${code}): ${err.trim().split("\n").slice(-3).join(" / ")}`));
    });
  });
}

export class AbortedError extends Error {
  constructor() {
    super("worker 종료로 중단됨");
  }
}

export async function probe(ffprobe: string, file: string): Promise<Probe> {
  const out = await run(ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]).catch(() => {
    throw new UserFacingError("영상 파일을 읽을 수 없습니다. mp4 · mov · mkv · webm 영상인지 확인해 주세요.");
  });
  const data = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: {
      codec_type?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
    }[];
  };
  const video = data.streams?.find((s) => s.codec_type === "video" && s.width && s.height);
  if (!video) throw new UserFacingError("영상이 들어 있지 않은 파일입니다.");
  const rate = (value?: string) => {
    const [n, d] = (value ?? "").split("/").map(Number);
    return n && d ? n / d : 0;
  };
  const durationSec = Number(data.format?.duration ?? video.duration ?? 0);
  if (!(durationSec > 0)) throw new UserFacingError("영상 길이를 알 수 없습니다.");
  return {
    durationSec,
    width: video.width!,
    height: video.height!,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate) || 30,
    hasAudio: !!data.streams?.some((s) => s.codec_type === "audio"),
  };
}

/** 운영자에게 그대로 보여 줄 수 있는 실패 (다시 시도해도 같다) */
export class UserFacingError extends Error {}

/** ffmpeg 한 번으로 모든 화질을 만든다 (원본을 한 번만 풀어 빠르다). out/<화질>/index.m3u8 + seg_00000.ts */
export function ffmpegArgs(
  input: string,
  outDir: string,
  keyInfo: string,
  src: Probe,
  renditions: Rendition[],
) {
  const fps = src.fps > MAX_FPS ? `fps=${MAX_FPS},` : "";
  const split = renditions.map((_, i) => `[s${i}]`).join("");
  const scales = renditions
    .map((r, i) => `[s${i}]scale=-2:${r.height}:flags=bicubic,format=yuv420p[o${i}]`)
    .join(";");
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-i",
    input,
    "-filter_complex",
    `[0:v]${fps}split=${renditions.length}${split};${scales}`,
  ];
  renditions.forEach((r, i) => {
    args.push("-map", `[o${i}]`);
    if (src.hasAudio) args.push("-map", "0:a:0");
    args.push(
      `-crf:v:${i}`,
      String(r.crf),
      `-maxrate:v:${i}`,
      `${r.maxrateKbps}k`,
      `-bufsize:v:${i}`,
      `${r.maxrateKbps * 2}k`,
    );
  });
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "high",
    "-level:v",
    "4.0",
    // 조각마다 키 장면으로 시작해야 화질을 바꾸거나 건너뛰어도 바로 재생된다
    "-force_key_frames",
    `expr:gte(t,n_forced*${HLS_SEGMENT_SEC})`,
    "-sc_threshold",
    "0",
  );
  if (src.hasAudio) args.push("-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ac", "2");
  args.push(
    "-var_stream_map",
    renditions
      .map((r, i) => (src.hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`))
      .join(" "),
    "-f",
    "hls",
    "-hls_time",
    String(HLS_SEGMENT_SEC),
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_key_info_file",
    keyInfo,
    "-hls_segment_filename",
    join(outDir, "%v", "seg_%05d.ts"),
    "-progress",
    "pipe:1",
    "-nostats",
    join(outDir, "%v", "index.m3u8"),
  );
  return args;
}

/** 재생 목록의 조각 길이 · 파일 크기로 평균 · 가장 높은 비트레이트 (kbps) */
async function measure(dir: string): Promise<{ avgKbps: number; peakKbps: number }> {
  const playlist = await readFile(join(dir, "index.m3u8"), "utf8");
  let duration = 0;
  let bytes = 0;
  let peak = 0;
  let pending: number | null = null;
  for (const line of playlist.split("\n")) {
    const inf = line.match(/^#EXTINF:([\d.]+)/);
    if (inf) pending = Number(inf[1]);
    else if (pending !== null && line.trim() && !line.startsWith("#")) {
      const size = (await stat(join(dir, line.trim()))).size;
      duration += pending;
      bytes += size;
      if (pending > 0.5) peak = Math.max(peak, (size * 8) / pending / 1000);
      pending = null;
    }
  }
  return { avgKbps: duration ? Math.round((bytes * 8) / duration / 1000) : 0, peakKbps: Math.round(peak) };
}

const CONTENT_TYPES: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl",
  ts: "video/mp2t",
};

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

/** 여러 개를 동시에 (최대 limit 개) */
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

export async function transcodeVideo(deps: VideoDeps, assetId: string, signal?: AbortSignal): Promise<void> {
  const { db } = deps;
  const ffmpeg = deps.ffmpeg ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const ffprobe = deps.ffprobe ?? process.env.FFPROBE_PATH ?? "ffprobe";
  const [asset] = await db.select().from(schema.videoAssets).where(eq(schema.videoAssets.id, assetId));
  if (!asset) return; // 그 사이 지워졌다
  if (asset.status !== "uploaded" && asset.status !== "transcoding") return; // 이미 처리했거나 아직 올리는 중

  const setAsset = (values: Partial<typeof schema.videoAssets.$inferInsert>) =>
    db.update(schema.videoAssets).set(values).where(eq(schema.videoAssets.id, assetId));
  await setAsset({ status: "transcoding", progress: 0, error: null, transcodeStartedAt: new Date() });

  const work = await mkdtemp(join(tmpdir(), "aionit-video-"));
  try {
    // 1. 원본 받기
    const source = await deps.store.get(asset.originalKey);
    if (!source) throw new UserFacingError("원본 파일이 저장소에 없습니다. 다시 올려 주세요.");
    const input = join(work, "source");
    await pipeline(source.body, createWriteStream(input), { signal });

    // 2. 살펴보기 ➔ 만들 화질
    const src = await probe(ffprobe, input);
    const renditions = planRenditions(src.height);
    const outDir = join(work, "out");
    for (const r of renditions) await mkdir(join(outDir, r.name), { recursive: true });

    // 3. 영상마다 새 키 (AES-128). 키 파일은 작업 폴더에만 두고 끝나면 지운다
    const key = randomBytes(16);
    const iv = randomBytes(16).toString("hex");
    await writeFile(join(work, "hls.key"), key);
    await writeFile(join(work, "keyinfo"), `${hlsKeyUrl(assetId)}\n${join(work, "hls.key")}\n${iv}\n`);

    // 4. 변환 (진행 상태: 3초마다 DB 에)
    let lastWrite = 0;
    let buffer = "";
    await run(ffmpeg, ffmpegArgs(input, outDir, join(work, "keyinfo"), src, renditions), {
      signal,
      nice: true,
      onStdout: (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
          if (!m) continue;
          const percent = Math.min(98, Math.floor((Number(m[1]) / 1e6 / src.durationSec) * 100));
          if (Date.now() - lastWrite > 3000) {
            lastWrite = Date.now();
            void setAsset({ progress: Math.max(0, percent) }).catch(() => undefined);
          }
        }
      },
    });

    // 5. 대표 재생 목록 (화질 목록). 실제 비트레이트를 재서 적는다 (재생기가 화질을 고를 때 쓴다)
    const results: VideoRendition[] = [];
    const master = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"];
    for (const r of renditions) {
      const { avgKbps, peakKbps } = await measure(join(outDir, r.name));
      const width = Math.round((src.width * r.height) / src.height / 2) * 2;
      results.push({ name: r.name, width, height: r.height, avgKbps, maxrateKbps: r.maxrateKbps });
      master.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${Math.max(peakKbps, avgKbps) * 1000},AVERAGE-BANDWIDTH=${avgKbps * 1000},RESOLUTION=${width}x${r.height},CODECS="${src.hasAudio ? "avc1.640028,mp4a.40.2" : "avc1.640028"}"`,
        `${r.name}/index.m3u8`,
      );
    }
    await writeFile(join(outDir, "master.m3u8"), `${master.join("\n")}\n`);
    await setAsset({ progress: 99 });

    // 6. 영상 버킷에 올리기 (전에 만든 것이 있으면 지우고)
    const paths = mediaPaths(assetId);
    await deps.media.deletePrefix(paths.hls);
    const files = await filesUnder(outDir);
    await eachLimit(files, 4, async (file) => {
      if (signal?.aborted) throw new AbortedError();
      const rel = relative(outDir, file).split(sep).join("/");
      const body = await readFile(file);
      await deps.media.put(`${paths.hls}${rel}`, body, {
        contentType: CONTENT_TYPES[rel.split(".").pop() ?? ""] ?? "application/octet-stream",
        size: body.length,
      });
    });

    // 7. 키 저장 + 준비 끝. 다시 변환한 것이면 예전 키는 지운다
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.hlsKeys)
        .values({ keySealed: sealHlsKey(deps.secret, key), keyVersion: HLS_KEY_VERSION })
        .returning({ id: schema.hlsKeys.id });
      await tx
        .update(schema.videoAssets)
        .set({
          status: "ready",
          progress: 100,
          error: null,
          durationSec: Math.round(src.durationSec),
          width: src.width,
          height: src.height,
          renditions: results,
          hlsPrefix: paths.hls,
          keyId: row!.id,
          readyAt: new Date(),
        })
        .where(eq(schema.videoAssets.id, assetId));
      if (asset.keyId) await tx.delete(schema.hlsKeys).where(eq(schema.hlsKeys.id, asset.keyId));
      await tx
        .update(schema.videoSlots)
        .set({ durationSec: Math.round(src.durationSec) })
        .where(eq(schema.videoSlots.videoAssetId, assetId));
    });
  } catch (error) {
    if (error instanceof AbortedError || signal?.aborted) {
      // worker 를 내리는 중: 다시 대기 상태로 두고 작업을 실패로 돌려 다시 시도하게 한다
      await setAsset({ status: "uploaded", progress: 0 }).catch(() => undefined);
      throw error;
    }
    const message =
      error instanceof UserFacingError
        ? error.message
        : `변환 중 오류: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`;
    console.error(`[worker] 영상 변환 실패 ${assetId}`, error);
    await setAsset({ status: "failed", error: message });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
