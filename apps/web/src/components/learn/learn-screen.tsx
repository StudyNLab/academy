"use client";

// L-02 학습 화면 (docs/화면상세기획.md 1장): 학습 머리글 · 목차 · 챕터 영상 ➔ 교재 ➔ 끼운 영상 · 스스로 확인 · 챕터 끝 요약
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MonoLabel, ProgressBar } from "@aionit/ui";
import { Reader } from "@/components/reader";
import { ThemeToggle } from "@/components/theme-toggle";
import type { LearnResult } from "@/server/learning";
import type { Beat, ChapterStatus, VideoTrack } from "./learn-sync";
import { LearnSync, trackVideos } from "./learn-sync";

type Data = Extract<LearnResult, { kind: "ok" }>;
type Lab = Data["labs"][number];

/** 학습 신호 간격 · 활동 없으면 멈추는 시간 (packages/core LEARNING_RULES_V1 과 같은 값) */
const TICK_MS = 30_000;
const IDLE_MS = 120_000;
/** 스크롤이 멈추고 이만큼 지나면 읽은 위치를 저장 */
const SAVE_DELAY_MS = 5_000;

const sizeText = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

/** 교재 배경의 아주 옅은 닉네임 워터마크 (유출 추적용, 글 선택 · 복사는 막지 않는다) */
function watermark(nickname: string): string {
  const text = nickname.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><text x="20" y="120" transform="rotate(-18 160 100)" font-family="sans-serif" font-size="15" fill="currentColor" fill-opacity="0.05">${text}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace("currentColor", "%23808080")}")`;
}

export function LearnScreen({ data, nickname }: { data: Data; nickname: string }) {
  const { course, chapter } = data;
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [labs, setLabs] = useState(data.labs);
  const [status, setStatus] = useState<ChapterStatus>({
    chapterKey: chapter.key,
    textDone: data.progress?.textDone ?? false,
    completed: data.progress?.completed ?? false,
    videosDone: data.videos.filter((v) => v.done).map((v) => v.key),
  });
  const [online, setOnline] = useState(true);
  const [current, setCurrent] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [banner, setBanner] = useState(() => {
    const sections = chapter.toc.filter((t) => t.level === 1);
    const last = sections.find((t) => t.id === data.progress?.lastSectionId);
    return last && last.id !== sections[0]?.id ? last : null;
  });

  const sync = useMemo(
    () =>
      new LearnSync((s) => {
        if (s.chapterKey === chapter.key) setStatus(s);
      }, setOnline),
    [chapter.key],
  );

  const onMount = useCallback((el: HTMLDivElement) => setRoot(el), []);
  const topSections = useMemo(() => chapter.toc.filter((t) => t.level === 1).map((t) => t.id), [chapter.toc]);

  // 읽은 위치 · 학습 신호 · 영상 시청
  useEffect(() => {
    if (!root) return;
    let lastActivity = Date.now();
    let lastTick = Date.now();
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSaved = "";
    let videos: VideoTrack[] = [];
    let stopped = false;

    const position = () => {
      let section: string | null = null;
      for (const id of topSections) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 140) section = id;
      }
      const rect = root.getBoundingClientRect();
      const readRatio = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / Math.max(1, rect.height)));
      const reachedEnd = rect.bottom <= window.innerHeight + 80;
      // 끝까지 내려왔으면 마지막 Section 을 읽은 것 (짧은 챕터는 마지막 Section 이 위까지 올라오지 않는다)
      if (reachedEnd && topSections.length > 0) section = topSections.at(-1)!;
      return { sectionId: section, readRatio, reachedEnd };
    };

    const savePosition = (keepalive = false) => {
      const p = position();
      const signature = `${p.sectionId}|${p.reachedEnd}|${p.readRatio.toFixed(2)}`;
      if (signature === lastSaved) return;
      lastSaved = signature;
      void sync.post(
        "/learn/progress",
        { courseId: course.id, chapterKey: chapter.key, ...p },
        { key: `progress:${course.id}:${chapter.key}`, keepalive },
      );
    };

    /** 지난 신호 뒤로 쌓인 교재 시간 · 영상 구간을 보낸다 */
    const tick = (keepalive = false) => {
      const now = Date.now();
      const at = new Date(now).toISOString();
      const beats: Beat[] = [];
      for (const v of videos) {
        const beat = v.take(at);
        if (beat) beats.push(beat);
      }
      const active = document.visibilityState === "visible" && now - lastActivity < IDLE_MS;
      const activeSec = Math.min(30, Math.round((now - lastTick) / 1000));
      if (active && activeSec > 0) beats.push({ chapterKey: chapter.key, kind: "text", at, activeSec });
      lastTick = now;
      void sync.beats(course.id, beats, keepalive);
    };

    const onActivity = () => {
      lastActivity = Date.now();
    };
    const onScroll = () => {
      onActivity();
      const p = position();
      setCurrent(p.sectionId);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => savePosition(), SAVE_DELAY_MS);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        savePosition(true);
        tick(true);
      }
    };
    const onOnline = () => void sync.flush();

    void trackVideos(root, chapter.key)
      .then((list) => {
        if (stopped) list.forEach((v) => v.player.destroy());
        else videos = list;
      })
      .catch(() => undefined);
    const sampler = setInterval(() => {
      for (const v of videos) {
        v.sample();
        if (v.playing) lastActivity = Date.now();
      }
    }, 1000);
    const ticker = setInterval(() => tick(), TICK_MS);
    void sync.flush();
    // 화면을 열기만 하고 나가면 저장하지 않는다 (마지막으로 읽은 곳을 맨 위로 덮어쓰지 않게)
    const initial = position();
    lastSaved = `${initial.sectionId}|${initial.reachedEnd}|${initial.readRatio.toFixed(2)}`;
    setCurrent(initial.sectionId);

    const events = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      stopped = true;
      // 다른 챕터로 옮길 때: 마지막 위치 · 신호를 보낸다
      savePosition(true);
      tick(true);
      clearTimeout(saveTimer);
      clearInterval(sampler);
      clearInterval(ticker);
      events.forEach((e) => window.removeEventListener(e, onActivity));
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      videos.forEach((v) => v.player.destroy());
    };
  }, [root, sync, course.id, chapter.key, topSections]);

  // 스스로 확인: 본문 안 자리(.self-check-slot)에 그린다
  const slots = useMemo(() => {
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>(".self-check-slot")].map((el) => ({
      el,
      sectionId: el.dataset.section!,
    }));
  }, [root]);

  function toggleCheck(sectionId: string, itemId: string, checked: boolean) {
    setLabs((all) =>
      all.map((l) =>
        l.sectionId !== sectionId
          ? l
          : { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, checked } : i)) },
      ),
    );
    void sync.post(
      "/learn/checks",
      { courseId: course.id, chapterKey: chapter.key, sectionId, itemId, checked },
      { key: `check:${course.id}:${chapter.key}:${sectionId}:${itemId}` },
    );
  }

  const checksTotal = labs.reduce((n, l) => n + l.items.length, 0);
  const checksDone = labs.reduce((n, l) => n + l.items.filter((i) => i.checked).length, 0);
  const videosDone = data.videos.filter((v) => status.videosDone.includes(v.key)).length;
  const completedBefore = data.progress?.completed ?? false;
  const percent =
    status.completed && !completedBefore
      ? Math.round(((data.chapters.filter((c) => c.done).length + 1) / data.chapters.length) * 100)
      : data.percent;

  const toc = (
    <Toc
      data={data}
      labs={labs}
      current={current}
      completed={status.completed}
      onNavigate={() => setTocOpen(false)}
    />
  );

  return (
    <div className="min-h-screen bg-bg pb-20 lg:pb-0">
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="flex min-h-[60px] items-center gap-x-4 px-4 md:px-8">
          <Link href="/learn" className="hidden shrink-0 text-[14px] text-ink no-underline md:inline">
            ← 내 강의실
          </Link>
          <Link href="/learn" aria-label="내 강의실" className="text-ink no-underline md:hidden">
            ←
          </Link>
          <span className="hidden h-5 w-px bg-line md:block" />
          <Link
            href={`/courses/${course.slug}`}
            className="min-w-0 truncate text-[15px] font-semibold text-ink no-underline"
          >
            <span className="hidden md:inline">{course.title}</span>
            <span className="md:hidden">
              {chapter.label || chapter.key} {chapter.title}
            </span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <div className="hidden w-[180px] flex-col gap-1 sm:flex">
              <span className="text-right text-[12px] tabular-nums text-ink-2">진도 {percent}%</span>
              <ProgressBar value={percent} label="과정 진도" />
            </div>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setTocOpen(true)}
              aria-label="목차 열기"
              className="inline-flex h-11 w-11 items-center justify-center text-ink lg:hidden"
            >
              ☰
            </button>
          </div>
        </div>
        <div className="sm:hidden">
          <ProgressBar value={percent} label="과정 진도" />
        </div>
        {!online ? (
          <p role="status" className="m-0 bg-warn px-4 py-2 text-center text-[13px] text-on-primary">
            연결이 끊겼습니다. 진도는 다시 연결되면 저장됩니다.
          </p>
        ) : null}
      </header>

      <div className="mx-auto grid max-w-[1296px] lg:grid-cols-[280px_1fr]">
        <aside className="hidden border-r border-line lg:block">
          <div className="sticky top-[61px] max-h-[calc(100vh-61px)] overflow-y-auto px-6 py-8">{toc}</div>
        </aside>

        <main
          className="min-w-0 px-5 pt-10 md:px-14"
          style={{ backgroundImage: watermark(nickname), backgroundRepeat: "repeat" }}
        >
          <div className="max-w-[720px]">
            {data.staff ? (
              <p className="m-0 mb-6 border-t-2 border-signal pt-2 text-[13px] text-ink-2">
                운영자 · 강사 보기: 진도는 남지만 학습 시간 정산에서는 빠집니다.
              </p>
            ) : data.daysLeft !== null && data.daysLeft <= 30 ? (
              <p className="m-0 mb-6 border-t-2 border-warn pt-2 text-[13px] text-ink-2">
                수강 기간이 {data.daysLeft}일 남았습니다.
              </p>
            ) : null}
            {banner ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-signal bg-surface px-4 py-3 text-[14px]">
                <span>
                  마지막으로 읽은 곳: <strong className="font-semibold">{banner.title}</strong>
                </span>
                <a href={`#${banner.id}`} onClick={() => setBanner(null)}>
                  이동
                </a>
                <button
                  type="button"
                  onClick={() => setBanner(null)}
                  className="ml-auto text-ink-2"
                  aria-label="닫기"
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>
          <div className="mt-4">
            <Reader html={data.html} onMount={onMount} />
          </div>
          {slots.map(({ el, sectionId }) => {
            const lab = labs.find((l) => l.sectionId === sectionId);
            return lab ? createPortal(<SelfCheck lab={lab} onToggle={toggleCheck} />, el, sectionId) : null;
          })}

          <section aria-label="이 챕터 정리" className="mt-16 max-w-[720px] border-t border-line-strong pt-6">
            <MonoLabel className="text-xs text-ink-2">이 챕터</MonoLabel>
            <p className="mt-2 mb-0 text-[15px]">
              {status.completed ? <strong className="font-semibold text-done">✓ 완료</strong> : "진행 중"}
              {" · "}교재 {status.textDone ? "✓" : "읽는 중"}
              {data.videos.length > 0 ? ` · 영상 ${videosDone}/${data.videos.length}` : ""}
              {checksTotal > 0 ? ` · 실습 체크 ${checksDone}/${checksTotal}` : ""}
            </p>
            {!status.completed ? (
              <p className="mt-1 mb-0 text-[13px] text-ink-2">
                끝까지 읽고{data.videos.length > 0 ? " 영상을 90% 이상 보고" : ""}
                {checksTotal > 0 ? " 스스로 확인을 모두 체크하면" : "으면"} 완료됩니다.
              </p>
            ) : null}
            {data.attachments.length > 0 ? (
              <ul className="mt-6 mb-0 flex list-none flex-col gap-2 p-0">
                {data.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={`/api/v1/learn/attachments/${a.id}`} download className="text-[15px]">
                      📎 {a.title}
                    </a>{" "}
                    <span className="text-[13px] text-ink-2">{sizeText(a.size)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <nav aria-label="이전 · 다음 챕터" className="mt-10 flex justify-between gap-6">
              {data.prev ? (
                <Link href={`/learn/${course.slug}/${data.prev.key}`} className="max-w-[45%] text-[15px]">
                  ← {data.prev.title}
                </Link>
              ) : (
                <span />
              )}
              {data.next ? (
                <Link
                  href={`/learn/${course.slug}/${data.next.key}`}
                  className="max-w-[45%] text-right text-[15px]"
                >
                  {data.next.title} →
                </Link>
              ) : null}
            </nav>
          </section>
        </main>
      </div>

      {/* 좁은 화면: 아래 고정 막대 + 목차 시트 */}
      <nav
        aria-label="챕터 이동"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-line bg-bg text-[14px] lg:hidden"
      >
        {data.prev ? (
          <Link
            href={`/learn/${course.slug}/${data.prev.key}`}
            className="flex min-h-12 items-center justify-center text-ink no-underline"
          >
            ← 이전
          </Link>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => setTocOpen(true)} className="min-h-12 text-ink">
          목차
        </button>
        {data.next ? (
          <Link
            href={`/learn/${course.slug}/${data.next.key}`}
            className="flex min-h-12 items-center justify-center text-ink no-underline"
          >
            다음 →
          </Link>
        ) : (
          <span />
        )}
      </nav>
      {tocOpen ? (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-label="목차">
          <button
            type="button"
            aria-label="목차 닫기"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setTocOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto bg-bg px-5 pt-4 pb-8 shadow-float">
            <div className="mb-3 flex justify-end">
              <button type="button" onClick={() => setTocOpen(false)} className="min-h-11 px-2 text-ink-2">
                닫기
              </button>
            </div>
            {toc}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Toc({
  data,
  labs,
  current,
  completed,
  onNavigate,
}: {
  data: Data;
  labs: Lab[];
  current: string | null;
  completed: boolean;
  onNavigate: () => void;
}) {
  const { course, chapter } = data;
  const main = data.videos.find((v) => v.kind === "main");
  return (
    <nav aria-label="목차" className="flex flex-col text-[14px]">
      <MonoLabel className="mb-3 text-xs text-ink-2">목차</MonoLabel>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {data.chapters.map((c) => {
          const here = c.key === chapter.key;
          const done = here ? completed : c.done;
          return (
            <li key={c.key}>
              <Link
                href={`/learn/${course.slug}/${c.key}`}
                onClick={onNavigate}
                aria-current={here ? "page" : undefined}
                className={`flex min-h-10 items-baseline gap-2 py-1.5 no-underline ${here ? "font-semibold text-ink" : "text-ink-2"}`}
              >
                <MonoLabel className="w-10 shrink-0 text-[11px] text-signal">
                  {c.label.replace(/^CHAPTER\s*/i, "CH") || c.key}
                </MonoLabel>
                <span className="flex-1">{c.title}</span>
                {done ? (
                  <span className="text-done" aria-label="완료">
                    ✓
                  </span>
                ) : null}
              </Link>
              {here ? (
                <ul className="m-0 mb-2 flex list-none flex-col border-l border-line p-0 pl-3">
                  {main ? (
                    <li>
                      <a
                        href={`#video-${main.key}`}
                        className="block py-1 text-ink-2 no-underline"
                        onClick={onNavigate}
                      >
                        🎬 {main.title}
                      </a>
                    </li>
                  ) : null}
                  {chapter.toc
                    .filter((t) => t.level === 1)
                    .map((t) => {
                      const lab = labs.find((l) => l.sectionId === t.id);
                      const checked = lab?.items.filter((i) => i.checked).length ?? 0;
                      return (
                        <li key={t.id}>
                          <a
                            href={`#${t.id}`}
                            onClick={onNavigate}
                            className={`-ml-[13px] flex items-baseline gap-2 border-l-2 py-1 pl-[11px] no-underline ${
                              current === t.id
                                ? "border-signal font-semibold text-ink"
                                : "border-transparent text-ink-2"
                            }`}
                          >
                            <span className="flex-1">{t.title}</span>
                            {lab ? (
                              <span
                                className={`text-[12px] tabular-nums ${checked === lab.items.length ? "text-done" : ""}`}
                              >
                                {checked === lab.items.length ? "✓" : "☐"} {checked}/{lab.items.length}
                              </span>
                            ) : null}
                          </a>
                          {data.videos
                            .filter((v) => v.kind !== "main" && v.sectionId === t.id)
                            .map((v) => (
                              <a
                                key={v.key}
                                href={`#video-${v.key}`}
                                onClick={onNavigate}
                                className="block py-1 pl-2 text-[13px] text-ink-2 no-underline"
                              >
                                🎬 {v.title}
                              </a>
                            ))}
                        </li>
                      );
                    })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SelfCheck({
  lab,
  onToggle,
}: {
  lab: Lab;
  onToggle: (sectionId: string, itemId: string, checked: boolean) => void;
}) {
  const done = lab.items.filter((i) => i.checked).length;
  return (
    <div className="self-check">
      <p className="self-check-title">
        <span>✅ 스스로 확인</span>
        <span className="tabular-nums">
          {done} / {lab.items.length}
        </span>
      </p>
      <ul>
        {lab.items.map((item) => (
          <li key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => onToggle(lab.sectionId, item.id, e.target.checked)}
              />
              <span>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
