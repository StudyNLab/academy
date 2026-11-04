// 학습 화면 → 서버 저장. 연결이 끊기면 브라우저(localStorage)에 모아 뒀다가 다시 연결되면 보낸다 (docs/화면상세기획.md 1.4)
import type { ChapterStatus } from "@/server/learning";

export type { ChapterStatus };

type Range = [number, number];

export type Beat =
  | { chapterKey: string; kind: "text"; at: string; activeSec: number }
  | {
      chapterKey: string;
      kind: "video";
      at: string;
      videoKey: string;
      ranges: Range[];
      positionSec: number;
      durationSec: number;
    };

interface Pending {
  path: string;
  body: Record<string, unknown>;
  /** 같은 key 는 마지막 것만 남긴다 (읽은 위치) */
  key?: string;
}

const STORE = "aionit.learn.queue";
const MAX_BEATS = 120;

function load(): Pending[] {
  try {
    const raw = window.localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Pending[]) : [];
  } catch {
    return [];
  }
}

function save(items: Pending[]) {
  try {
    if (items.length) window.localStorage.setItem(STORE, JSON.stringify(items.slice(-500)));
    else window.localStorage.removeItem(STORE);
  } catch {
    // 저장할 수 없는 브라우저(사생활 보호 창 등): 이번 화면 안에서만 모아 둔다
  }
}

type Result = "ok" | "retry" | "drop";

async function send(
  path: string,
  body: unknown,
  keepalive = false,
): Promise<{ result: Result; data?: unknown }> {
  try {
    const response = await fetch(`/api/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      keepalive,
    });
    if (response.ok) return { result: "ok", data: await response.json().catch(() => null) };
    // 수강권이 끝났거나 잘못된 요청은 다시 보내도 같다. 서버 오류 · 횟수 제한은 다시 보낸다
    return { result: response.status >= 500 || response.status === 429 ? "retry" : "drop" };
  } catch {
    return { result: "retry" };
  }
}

export class LearnSync {
  private queue: Pending[] = [];
  private flushing = false;

  constructor(
    private readonly onStatus: (status: ChapterStatus) => void,
    private readonly onConnection: (online: boolean) => void,
  ) {
    this.queue = load();
  }

  private handle(data: unknown) {
    if (!data || typeof data !== "object") return;
    if ("chapterKey" in data) this.onStatus(data as ChapterStatus);
    if ("chapters" in data)
      for (const s of (data as { chapters: ChapterStatus[] }).chapters) this.onStatus(s);
  }

  private enqueue(item: Pending) {
    if (item.key) this.queue = this.queue.filter((q) => q.key !== item.key);
    this.queue.push(item);
    save(this.queue);
  }

  /** 바로 보내 보고, 안 되면 모아 둔다 */
  async post(
    path: string,
    body: Record<string, unknown>,
    options: { key?: string; keepalive?: boolean } = {},
  ) {
    if (this.queue.length > 0 && !options.keepalive) {
      this.enqueue({ path, body, key: options.key });
      return this.flush();
    }
    const { result, data } = await send(path, body, options.keepalive);
    if (result === "retry") {
      this.enqueue({ path, body, key: options.key });
      this.onConnection(false);
    } else {
      this.handle(data);
      if (result === "ok") this.onConnection(true);
    }
  }

  beats(courseId: string, beats: Beat[], keepalive = false) {
    if (beats.length === 0) return;
    return this.post("/learn/heartbeats", { courseId, beats: beats.slice(-MAX_BEATS) }, { keepalive });
  }

  /** 모아 둔 것을 차례로 보낸다. 같은 과정의 학습 신호는 하나로 묶는다 */
  async flush() {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const head = this.queue[0]!;
        let take = 1;
        let body = head.body;
        if (head.path === "/learn/heartbeats") {
          const beats: Beat[] = [];
          while (
            take <= this.queue.length &&
            this.queue[take - 1]!.path === head.path &&
            this.queue[take - 1]!.body.courseId === head.body.courseId &&
            beats.length + (this.queue[take - 1]!.body.beats as Beat[]).length <= MAX_BEATS
          ) {
            beats.push(...(this.queue[take - 1]!.body.beats as Beat[]));
            take += 1;
          }
          take = Math.max(1, take - 1);
          body = { courseId: head.body.courseId, beats };
        }
        const { result, data } = await send(head.path, body);
        if (result === "retry") {
          this.onConnection(false);
          return;
        }
        this.handle(data);
        this.queue.splice(0, take);
        save(this.queue);
      }
      this.onConnection(true);
    } finally {
      this.flushing = false;
    }
  }
}

// ---- 유튜브 시청 기록 (IFrame Player API) ----

interface YtPlayer {
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

interface YtNamespace {
  Player: new (
    element: HTMLIFrameElement,
    options: { events?: Record<string, (event: unknown) => void> },
  ) => YtPlayer;
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YtNamespace> | null = null;

/** 유튜브 플레이어 API 를 처음 필요할 때 한 번만 불러온다 (CSP 'strict-dynamic' 이라 우리 스크립트가 넣은 스크립트는 허용된다) */
function loadYouTubeApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

const PLAYING = 1;

/** 영상 하나의 재생 구간 (콘텐츠 시간 기준). 1초마다 재생 위치를 보고, 이어지면 늘리고 건너뛰면 새 구간 */
class VideoTrack {
  private ranges: Range[] = [];
  private current: Range | null = null;
  private last: number | null = null;

  constructor(
    readonly key: string,
    readonly chapterKey: string,
    readonly player: YtPlayer,
  ) {}

  get playing(): boolean {
    try {
      return this.player.getPlayerState() === PLAYING;
    } catch {
      return false;
    }
  }

  sample() {
    if (!this.playing) {
      this.close();
      return;
    }
    const t = this.player.getCurrentTime();
    // 1초 사이 3.5초 넘게 갔거나 뒤로 갔으면 건너뛴 것 (배속 2배까지는 이어 본 것)
    if (this.current && this.last !== null && t >= this.last && t - this.last <= 3.5) this.current[1] = t;
    else {
      this.close();
      this.current = [t, t];
    }
    this.last = t;
  }

  private close() {
    if (this.current && this.current[1] > this.current[0]) this.ranges.push(this.current);
    this.current = null;
    this.last = null;
  }

  /** 지난 신호 뒤로 본 구간을 꺼낸다 */
  take(at: string): Beat | null {
    const open = this.current;
    if (open && open[1] > open[0]) {
      this.ranges.push([open[0], open[1]]);
      this.current = [open[1], open[1]];
    }
    if (this.ranges.length === 0) return null;
    const ranges = this.ranges.map(([s, e]) => [Math.round(s * 10) / 10, Math.round(e * 10) / 10] as Range);
    this.ranges = [];
    return {
      chapterKey: this.chapterKey,
      kind: "video",
      at,
      videoKey: this.key,
      ranges,
      positionSec: Math.floor(this.player.getCurrentTime()),
      durationSec: Math.floor(this.player.getDuration() || 0),
    };
  }
}

export async function trackVideos(root: HTMLElement, chapterKey: string): Promise<VideoTrack[]> {
  const frames = [...root.querySelectorAll<HTMLIFrameElement>("iframe[data-video-key]")];
  if (frames.length === 0) return [];
  const YT = await loadYouTubeApi();
  return frames.map((frame) => new VideoTrack(frame.dataset.videoKey!, chapterKey, new YT.Player(frame, {})));
}

export type { VideoTrack };
