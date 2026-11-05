"use client";

// L-02 학습 화면 (docs/화면상세기획.md 1장): 학습 머리글 · 목차 · 챕터 영상 ➔ 교재 ➔ 끼운 영상 · 스스로 확인 · 챕터 끝 요약
// + Q&A 패널 (L-06, 1.6): 머리글 [Q&A n] 으로 연다. 알림에서 오면 ?qna=질문id 로 그 질문을 연다
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogoMark, LogoWord } from "@aionit/ui";
import { Reader } from "@/components/reader";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/client-api";
import type { Playback } from "@/server/videos";
import type { LearnResult } from "@/server/learning";
import { SvcIcon } from "@/components/icons";
import { HostedVideo } from "./hosted-video";
import { QnaPanel } from "./qna-panel";
import type { Beat, ChapterStatus } from "./learn-sync";
import { html5Player, LearnSync, trackVideos, VideoTrack } from "./learn-sync";

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

export function LearnScreen({
  data,
  nickname,
  qnaCount,
}: {
  data: Data;
  nickname: string;
  qnaCount: number;
}) {
  const { course, chapter } = data;
  const router = useRouter();
  const [qna, setQna] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
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

  // 알림 · 메일의 링크(?qna=질문id)로 오면 그 질문을 연다
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("qna");
    if (id) setQna({ open: true, id });
  }, []);

  /** 자체 서버 영상: 재생을 시작하면 HostedVideo 가 넘긴 video 요소로 시청 구간을 잰다 */
  const hostedTracks = useRef(new Map<string, VideoTrack>());
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
      for (const v of [...videos, ...hostedTracks.current.values()]) {
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
      for (const v of [...videos, ...hostedTracks.current.values()]) {
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

  // 자체 서버 영상: 본문 안 자리(.hosted-video)에 플레이어를 그린다
  const hostedSlots = useMemo(() => {
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>(".hosted-video")].map((el) => ({
      el,
      key: el.dataset.hostedKey!,
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

  const currentSection = (() => {
    const t = chapter.toc.find((item) => item.level === 1 && item.id === current);
    return t ? { id: t.id, title: t.title } : null;
  })();

  const toc = (
    <Toc
      data={data}
      labs={labs}
      current={current}
      completed={status.completed}
      percent={percent}
      onNavigate={() => setTocOpen(false)}
    />
  );

  const sections = chapter.toc.filter((t) => t.level === 1);
  const openQna = () => setQna((v) => ({ open: !v.open, id: null }));

  return (
    <div className={`pb-16 md:pb-0 ${qna.open ? "qa-open" : ""}`}>
      <header className="reader-header">
        <div className="reader-header-left">
          <Link className="logo" href="/" aria-label="AIONIT 홈">
            <LogoMark />
            <LogoWord />
          </Link>
          <span className="reader-divider" />
          <Link href={`/courses/${course.slug}`} className="reader-course-name">
            {course.title}
          </Link>
        </div>
        <div className="reader-header-actions">
          <span className="reader-save" role="status">
            {online ? (
              <>
                <SvcIcon name="check" /> 진도 저장 중
              </>
            ) : (
              "연결이 끊겼습니다"
            )}
          </span>
          <ThemeToggle className="icon-btn theme-btn" />
          <button
            type="button"
            className="btn secondary small"
            onClick={openQna}
            aria-expanded={qna.open}
            aria-label={`Q&A, 이 챕터의 미해결 질문 ${qnaCount}개`}
          >
            <SvcIcon name="chat" /> Q&amp;A <span>{qnaCount}</span>
          </button>
          <Link className="icon-btn" href="/learn" aria-label="내 강의실">
            <SvcIcon name="user" />
          </Link>
        </div>
      </header>
      {!online ? (
        <p role="status" className="reader-state-banner m-0">
          연결이 끊겼습니다. 진도는 다시 연결되면 저장됩니다.
        </p>
      ) : null}

      <div className="reader-shell">
        <aside className="toc" aria-label="강의 목차">
          {toc}
        </aside>

        <main
          className="reader-workspace"
          style={{ backgroundImage: watermark(nickname), backgroundRepeat: "repeat" }}
        >
          <div className="reading-layout">
            <article className="reading-main">
              {data.staff ? (
                <div className="notice mb-6 text-[13px]">
                  운영자 · 강사 보기: 진도는 남지만 학습 시간 정산에서는 빠집니다.
                </div>
              ) : data.daysLeft !== null && data.daysLeft <= 30 ? (
                <div className="notice warn mb-6 text-[13px]">수강 기간이 {data.daysLeft}일 남았습니다.</div>
              ) : null}
              {banner ? (
                <div className="resume-banner">
                  <span>
                    마지막으로 읽은 곳: <strong>{banner.title}</strong>
                  </span>
                  <span className="flex items-center gap-3">
                    <a href={`#${banner.id}`} onClick={() => setBanner(null)}>
                      이동 <SvcIcon name="arrow" />
                    </a>
                    <button type="button" onClick={() => setBanner(null)} aria-label="닫기">
                      <SvcIcon name="close" />
                    </button>
                  </span>
                </div>
              ) : null}
              <Reader html={data.html} onMount={onMount} />
              {hostedSlots.map(({ el, key }) => {
                const video = data.videos.find((v) => v.key === key);
                return video
                  ? createPortal(
                      <HostedVideo
                        title={video.title}
                        startAt={data.startAt[key]}
                        load={() =>
                          api<Playback>("/learn/videos/playback", { courseId: course.id, videoKey: key })
                        }
                        onVideo={(el) =>
                          hostedTracks.current.set(key, new VideoTrack(key, chapter.key, html5Player(el)))
                        }
                      />,
                      el,
                      key,
                    )
                  : null;
              })}
              {slots.map(({ el, sectionId }) => {
                const lab = labs.find((l) => l.sectionId === sectionId);
                return lab
                  ? createPortal(<SelfCheck lab={lab} onToggle={toggleCheck} />, el, sectionId)
                  : null;
              })}

              <section aria-label="이 챕터 정리" className="chapter-end" id="finish">
                <div className="eyebrow muted">{status.completed ? "CHAPTER COMPLETE" : "THIS CHAPTER"}</div>
                <h3>{status.completed ? "이 챕터를 마쳤습니다." : "오늘의 배움을 정리해 볼까요?"}</h3>
                <div className="completion-row">
                  <span>교재 끝까지 읽기</span>
                  <span>{status.textDone ? "✓ 완료" : "본문 끝에 도달하면 완료"}</span>
                </div>
                {data.videos.length > 0 ? (
                  <div className="completion-row">
                    <span>영상 90% 이상 보기</span>
                    <span>
                      {videosDone} / {data.videos.length}
                    </span>
                  </div>
                ) : null}
                {checksTotal > 0 ? (
                  <div className="completion-row">
                    <span>스스로 확인 모두 체크</span>
                    <span>
                      {checksDone} / {checksTotal}
                    </span>
                  </div>
                ) : null}
                <p className="mt-3 mb-0 text-[13px] text-muted">
                  {status.completed ? "✓ 이 챕터 완료" : "진행 중"} · 시험이나 퀴즈는 없습니다.
                </p>
                {data.attachments.length > 0 ? (
                  <ul className="mt-5 mb-0 flex list-none flex-col gap-2 p-0">
                    {data.attachments.map((a) => (
                      <li key={a.id}>
                        <a
                          href={`/api/v1/learn/attachments/${a.id}`}
                          download
                          className="btn secondary small"
                        >
                          <SvcIcon name="code" /> {a.title}{" "}
                          <span className="text-muted">{sizeText(a.size)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <nav aria-label="이전 · 다음 챕터" className="mt-8 grid grid-cols-2 gap-4">
                  {data.prev ? (
                    <Link
                      href={`/learn/${course.slug}/${data.prev.key}`}
                      className="surface block p-5 no-underline"
                    >
                      <small className="block text-muted">이전 챕터</small>
                      <strong>{data.prev.title}</strong>
                    </Link>
                  ) : (
                    <span />
                  )}
                  {data.next ? (
                    <Link
                      href={`/learn/${course.slug}/${data.next.key}`}
                      className="surface block p-5 text-right no-underline"
                    >
                      <small className="block text-muted">다음 챕터</small>
                      <strong>{data.next.title} →</strong>
                    </Link>
                  ) : null}
                </nav>
              </section>
            </article>

            <aside className="reading-rail" aria-label="이 페이지에서">
              <h3>ON THIS PAGE</h3>
              {sections.map((t) => (
                <a key={t.id} href={`#${t.id}`} className={current === t.id ? "active" : undefined}>
                  {t.title}
                </a>
              ))}
              <div className="rail-qa">
                <p>
                  혼자 고민하고 있나요?
                  <br />
                  교재 옆에서 질문하세요.
                </p>
                <button type="button" onClick={openQna}>
                  <SvcIcon name="chat" /> Q&amp;A <span className="tag tag-outline">{qnaCount}</span>
                </button>
              </div>
            </aside>
          </div>
        </main>
      </div>

      {qna.open ? (
        // 데스크톱: 오른쪽 칸 (시안 .qa-panel, 본문을 밀어낸다) / 좁은 화면: 전체 화면
        <aside className="qa-panel max-md:inset-0 max-md:w-full">
          <QnaPanel
            courseId={course.id}
            chapterKey={chapter.key}
            chapterName={`${chapter.label.replace(/^CHAPTER\s*/i, "CH") || chapter.key} ${chapter.title}`}
            section={currentSection}
            openId={qna.id}
            onClose={() => setQna({ open: false, id: null })}
            onChanged={() => router.refresh()}
          />
        </aside>
      ) : null}

      {/* 좁은 화면: 아래 고정 막대 + 목차 시트 (시안은 좁은 화면에서 머리글의 Q&A · 목차를 숨긴다) */}
      <nav
        aria-label="챕터 이동"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface text-[14px] md:hidden"
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
        <button type="button" onClick={openQna} className="min-h-12 text-ink">
          Q&amp;A {qnaCount}
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
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="목차">
          {/* 바깥을 눌러도 닫힌다 (화면 읽기 프로그램에는 아래 [닫기] 하나만) */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 bg-ink/40"
            onClick={() => setTocOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-paper px-5 pt-4 pb-8 shadow-float">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => setTocOpen(false)}
                aria-label="목차 닫기"
                className="min-h-11 px-2 text-muted"
              >
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

/** 목차 (시안 .toc): 내 강의실로 · 과정 이름 · 진도 · 챕터 목록 (지금 챕터는 구역 · 실습 체크 수까지) */
function Toc({
  data,
  labs,
  current,
  completed,
  percent,
  onNavigate,
}: {
  data: Data;
  labs: Lab[];
  current: string | null;
  completed: boolean;
  percent: number;
  onNavigate: () => void;
}) {
  const { course, chapter } = data;
  const main = data.videos.find((v) => v.kind === "main");
  const doneCount = data.chapters.filter((c) => (c.key === chapter.key ? completed : c.done)).length;
  return (
    <>
      <Link className="toc-back" href="/learn">
        <SvcIcon name="back" /> 내 강의실
      </Link>
      <div className="toc-title">
        <span className="eyebrow muted">YOUR FIELD GUIDE</span>
        <h2>{course.title}</h2>
        <div className="toc-progress">
          <span>나의 학습 진도</span>
          <strong>{percent}%</strong>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="과정 진도"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="toc-progress">
          <span>
            {doneCount} / {data.chapters.length} 챕터 완료
          </span>
        </div>
      </div>
      <nav aria-label="목차">
        {data.chapters.map((c, i) => {
          const here = c.key === chapter.key;
          const done = here ? completed : c.done;
          return (
            <div key={c.key}>
              <Link
                href={`/learn/${course.slug}/${c.key}`}
                onClick={onNavigate}
                aria-current={here ? "page" : undefined}
                className={`toc-item ${here ? "current" : ""}`}
              >
                <SvcIcon name={done ? "check" : "book"} />
                <span className="num">{String(i + 1).padStart(2, "0")}</span>
                <span>{c.title}</span>
                {done ? <span className="sr-only">완료</span> : null}
              </Link>
              {here ? (
                <div className="toc-sub">
                  {main ? (
                    <a href={`#video-${main.key}`} onClick={onNavigate}>
                      영상 · {main.title}
                    </a>
                  ) : null}
                  {chapter.toc
                    .filter((t) => t.level === 1)
                    .map((t) => {
                      const lab = labs.find((l) => l.sectionId === t.id);
                      const checked = lab?.items.filter((item) => item.checked).length ?? 0;
                      return (
                        <span key={t.id} className="contents">
                          <a
                            href={`#${t.id}`}
                            onClick={onNavigate}
                            className={current === t.id ? "active" : undefined}
                          >
                            {t.title}
                            {lab ? (
                              <span className="toc-count">
                                {checked}/{lab.items.length}
                              </span>
                            ) : null}
                          </a>
                          {data.videos
                            .filter((v) => v.kind !== "main" && v.sectionId === t.id)
                            .map((v) => (
                              <a key={v.key} href={`#video-${v.key}`} onClick={onNavigate}>
                                영상 · {v.title}
                              </a>
                            ))}
                        </span>
                      );
                    })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </>
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
        <span>스스로 확인</span>
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
