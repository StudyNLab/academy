"use client";

// 자체 서버 영상 플레이어 (docs/기술설계.md 5.2 재생, docs/화면상세기획.md 1.5 콘텐츠 보호).
// 누르면 재생 정보(5분짜리 토큰)를 받아 hls.js 로 암호화 HLS 를 튼다. 재생 목록 · 조각 · 키 요청마다 토큰을 머리글에 싣고,
// 4분마다 토큰을 새로 받는다 (그때 수강권도 다시 확인된다). 화면 위에 닉네임 · 회원 번호 일부를 옮겨 다니며 보여 준다.
import type HlsType from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResult } from "@/lib/client-api";
import type { Playback } from "@/server/videos";

/** @aionit/core/media 의 MEDIA_TOKEN_HEADER (그 모듈은 서버 전용이라 값만 옮겨 둔다) */
const TOKEN_HEADER = "x-media-token";
const REFRESH_MS = 4 * 60_000;
const MOVE_MS = 12_000;

type State =
  { kind: "idle" } | { kind: "loading" } | { kind: "playing" } | { kind: "stopped"; message: string };

export function HostedVideo({
  title,
  load,
  startAt,
  onVideo,
}: {
  title: string;
  /** 재생 정보 받기 (학습 화면: /learn/videos/playback, 운영자: /admin/videos/{id}/playback) */
  load: () => Promise<ApiResult<Playback>>;
  /** 이어서 볼 위치 (초) */
  startAt?: number;
  /** 재생을 시작하면 video 요소를 넘긴다 (시청 기록) */
  onVideo?: (el: HTMLVideoElement) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const token = useRef("");
  const hls = useRef<HlsType | null>(null);
  const blobs = useRef<string[]>([]);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [mark, setMark] = useState("");
  const [tracks, setTracks] = useState<{ src: string; lang: string; label: string }[]>([]);
  const [spot, setSpot] = useState({ left: 6, top: 8 });

  const stop = useCallback((message: string) => {
    hls.current?.stopLoad();
    video.current?.pause();
    setState({ kind: "stopped", message });
  }, []);

  /** 토큰 새로 받기. 수강권이 끝났으면 멈춘다 */
  const refresh = useCallback(async (): Promise<boolean> => {
    const result = await load();
    if (result.ok) {
      token.current = result.data.token;
      return true;
    }
    if (result.error.status === 401 || result.error.status === 403 || result.error.status === 404) {
      stop(result.error.message);
      return false;
    }
    return true; // 잠깐 끊긴 것: 지금 토큰으로 계속 (만료되면 오류 처리에서 다시 받는다)
  }, [load, stop]);

  async function start() {
    setState({ kind: "loading" });
    const result = await load();
    if (!result.ok) return setState({ kind: "stopped", message: result.error.message });
    const playback = result.data;
    token.current = playback.token;
    setMark(playback.mark);
    const { default: Hls } = await import("hls.js");
    const el = video.current;
    if (!el) return;
    if (!Hls.isSupported()) {
      return setState({
        kind: "stopped",
        message:
          "이 브라우저에서는 수강생 전용 영상을 재생할 수 없습니다. 최신 Chrome · Edge · Safari · Firefox 를 써 주세요.",
      });
    }
    let networkRetries = 0;
    const player = new Hls({
      startPosition: startAt && startAt > 0 ? startAt : -1,
      capLevelToPlayerSize: true,
      xhrSetup: (xhr) => xhr.setRequestHeader(TOKEN_HEADER, token.current),
    });
    hls.current = player;
    player.on(Hls.Events.MANIFEST_PARSED, () => {
      networkRetries = 0;
      void el.play().catch(() => undefined);
    });
    player.on(Hls.Events.FRAG_LOADED, () => {
      networkRetries = 0;
    });
    player.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
        // 토큰이 만료됐거나 잠깐 끊겼다: 토큰을 새로 받고 이어서
        networkRetries += 1;
        void refresh().then((ok) => ok && player.startLoad());
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        player.recoverMediaError();
      } else {
        stop("영상을 불러오지 못했습니다. 화면을 새로 고쳐 다시 시도해 주세요.");
      }
    });
    player.loadSource(playback.src);
    player.attachMedia(el);
    onVideo?.(el);
    setState({ kind: "playing" });

    // 자막: 토큰을 실어 받은 뒤 브라우저 안 주소(blob:)로 붙인다 (<track> 은 머리글을 실을 수 없다)
    const loaded = await Promise.all(
      playback.subtitles.map(async (s) => {
        const response = await fetch(s.src, { headers: { [TOKEN_HEADER]: token.current } }).catch(() => null);
        if (!response?.ok) return null;
        const src = URL.createObjectURL(new Blob([await response.text()], { type: "text/vtt" }));
        blobs.current.push(src);
        return { src, lang: s.lang, label: s.label };
      }),
    );
    setTracks(loaded.filter((t): t is NonNullable<typeof t> => !!t));
  }

  // 재생하는 동안: 4분마다 토큰 새로 받기, 화면에 다시 돌아오면 바로 한 번
  useEffect(() => {
    if (state.kind !== "playing") return;
    let last = Date.now();
    const timer = setInterval(() => {
      last = Date.now();
      void refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 3 * 60_000) {
        last = Date.now();
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.kind, refresh]);

  // 워터마크 위치를 천천히 바꾼다
  useEffect(() => {
    if (state.kind !== "playing") return;
    const timer = setInterval(
      () => setSpot({ left: 4 + Math.random() * 60, top: 6 + Math.random() * 70 }),
      MOVE_MS,
    );
    return () => clearInterval(timer);
  }, [state.kind]);

  // 전체 화면은 워터마크가 함께 보이도록 영상이 아니라 감싼 상자를 키운다 (영상만 키우면 바꿔 준다)
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement && document.fullscreenElement === video.current) {
        void document.exitFullscreen().then(() => box.current?.requestFullscreen());
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(
    () => () => {
      hls.current?.destroy();
      blobs.current.forEach((b) => URL.revokeObjectURL(b));
    },
    [],
  );

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen().catch(() => undefined);
  }

  return (
    <div
      ref={box}
      className="hosted-player relative h-full w-full bg-[#1b2534]"
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={video}
        className="absolute inset-0 h-full w-full"
        controls={state.kind === "playing"}
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture
        playsInline
        onDoubleClick={(e) => {
          e.preventDefault();
          toggleFullscreen();
        }}
        aria-label={title}
      >
        {tracks.map((t, i) => (
          <track
            key={t.src}
            kind="subtitles"
            src={t.src}
            srcLang={t.lang}
            label={t.label}
            default={i === 0}
          />
        ))}
      </video>
      {state.kind === "playing" ? (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute select-none whitespace-nowrap text-[13px] font-semibold text-white/45 [text-shadow:0_0_3px_rgba(0,0,0,0.6)] transition-[left,top] duration-[3000ms] ease-in-out"
            style={{ left: `${spot.left}%`, top: `${spot.top}%` }}
          >
            {mark}
          </span>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute top-2 right-2 rounded-sm bg-black/50 px-2 py-1 text-[12px] text-white"
          >
            전체 화면
          </button>
        </>
      ) : null}
      {state.kind === "idle" || state.kind === "loading" ? (
        <button
          type="button"
          onClick={() => void start()}
          disabled={state.kind === "loading"}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white"
          aria-label={`${title} 재생`}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-[22px]">
            ▶
          </span>
          <span className="text-[14px]">
            {state.kind === "loading" ? "불러오는 중…" : "수강생 전용 영상"}
          </span>
        </button>
      ) : null}
      {state.kind === "stopped" ? (
        <p
          role="alert"
          className="absolute inset-0 m-0 flex items-center justify-center p-6 text-center text-[14px] text-white"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
