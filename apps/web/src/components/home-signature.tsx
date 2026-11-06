"use client";

// 홈 상단 Signature — 소개 · 3장면 순환 그림 · 분야 띠.
// 디자인 저장소 StudyNLab/aionit-design 태그 v2-2026-11-06 의 screens/home.html · behavior/home-carousel.js 를 옮긴 것.
// 그림 속 책 제목 · 코드 · 서버 응답은 그림 예시다 (시안 data-sample: 실제 실행 · 진단 기능이 아님).
// 순환: 9초마다 다음 장면. 멈춤 단추로 멈추고, 그림에 마우스 · 장면 단추에 키보드 초점 · 탭이 숨으면 잠시 멈춘다.
// '움직임 줄이기' 설정이면 처음부터 멈춘 채로 시작하고, 도중에 그 설정으로 바뀌어도 멈춘다 (behavior/README.md).
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "@/app/home-signature.css";

const DURATION = 9000;
const ART_ID = "home-hero-art";

const slides = [
  { title: "배움이 일어나는 곳", sub: "교재 · 실습 · Q&A" },
  { title: "이해를 실력으로", sub: "읽고 · 실행하고 · 완성하고" },
  { title: "기술을 연결하는 힘", sub: "인프라 · 보안 · AI" },
];

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void) {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function HomeSignature({ previewHref }: { previewHref: string }) {
  const reduced = useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia(REDUCE).matches,
    () => false,
  );
  const pageHidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.hidden,
    () => false,
  );
  // 사용자가 멈춤 · 재생을 고르기 전에는 '움직임 줄이기' 설정을 따른다
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const elapsed = useRef(0);

  const paused = choice ? choice === "pause" : reduced;
  const stopped = paused || hovered || keyboardFocus || pageHidden;

  // 도중에 '움직임 줄이기'로 바뀌면 사용자가 고른 재생도 풀고 다시 멈춘다
  useEffect(() => {
    const mq = window.matchMedia(REDUCE);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setChoice(null);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // 멈춘 동안은 흐른 시간을 그대로 둔다. 진행 막대는 다시 그리지 않고 CSS 변수로만 움직인다
  useEffect(() => {
    if (stopped) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      elapsed.current += now - last;
      last = now;
      if (elapsed.current >= DURATION) {
        elapsed.current = 0;
        setActive((i) => (i + 1) % slides.length);
      }
      barRef.current?.style.setProperty("--slide-progress", String(Math.min(elapsed.current / DURATION, 1)));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [stopped]);

  function select(index: number) {
    elapsed.current = 0;
    barRef.current?.style.setProperty("--slide-progress", "0");
    setActive(index);
  }

  const toggleLabel = paused ? "자동 순환 재생" : "자동 순환 일시정지";

  return (
    <div className="aionit-home">
      <ArtDefs />
      <section aria-label="AIONIT 소개" className="hs-hero">
        <div className="hs-hero-copy">
          <div className="hs-eyebrow">TECHNOLOGY, MADE YOURS.</div>
          <h1>
            기술을 이해하고,
            <br />
            <em>가능성을 실행하다.</em>
          </h1>
          <p className="hs-hero-desc">
            인프라부터 보안, AI 에이전트까지.
            <br />
            읽고, 실행하고, 질문하며
            <br />
            <strong>현업의 문제를 해결하는 실력</strong>을 만듭니다.
          </p>
          <div className="hs-hero-actions">
            <Link className="hs-primary" href="/courses">
              배움 시작하기 <span aria-hidden="true">↗</span>
            </Link>
            <Link href={previewHref}>
              교재 미리보기 <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="hs-copy-foot">
            <span />
            영상으로 이해하고 · 교재로 정리하고 · 실습으로 완성합니다
          </div>
        </div>
        <div
          className="hs-art-wrap"
          id={ART_ID}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div aria-hidden="true" className="hs-art-aura" />
          <div aria-hidden="true" className="hs-art-grid" />
          <SceneWorkspace hidden={active !== 0} />
          <SceneJourney hidden={active !== 1} />
          <SceneConnected hidden={active !== 2} />
        </div>
      </section>

      <section
        ref={barRef}
        aria-label="메인 비주얼 선택"
        className={`hs-carousel-bar ${stopped ? "hs-is-paused" : ""}`}
        onFocus={(event) => setKeyboardFocus(event.target.matches(":focus-visible"))}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
        }}
      >
        <div className="hs-carousel-tabs">
          {slides.map((slide, i) => (
            <button
              key={slide.title}
              type="button"
              aria-controls={ART_ID}
              aria-pressed={active === i}
              className="hs-slide-tab"
              onClick={() => select(i)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <strong>{slide.title}</strong>
                <small>{slide.sub}</small>
              </div>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={toggleLabel}
          title={toggleLabel}
          className="hs-carousel-control"
          onClick={() => {
            setChoice(paused ? "play" : "pause");
            setKeyboardFocus(false);
          }}
        >
          {paused ? "▶" : "Ⅱ"}
        </button>
      </section>

      <section aria-label="학습 분야" className="hs-fields">
        <p className="hs-fields-intro">
          하나의 기술을 넘어,
          <br />
          서로 연결되는 실무의 세계로.
        </p>
        <Link className="hs-field" href="/courses?field=infra">
          <span>01</span>
          <div>
            인프라<small>BUILD THE FOUNDATION</small>
          </div>
        </Link>
        <Link className="hs-field" href="/courses?field=security">
          <span>02</span>
          <div>
            보안<small>PROTECT WHAT MATTERS</small>
          </div>
        </Link>
        <Link className="hs-field" href="/courses?field=ai">
          <span>03</span>
          <div>
            AI<small>EXPAND YOUR POSSIBILITIES</small>
          </div>
        </Link>
      </section>
    </div>
  );
}

/** 그림에 쓰는 그라데이션 · 번짐 (id 는 home-signature.css 와 같이 aionit-sig-*, 홈에 한 번만 그린다) */
function ArtDefs() {
  return (
    <svg aria-hidden="true" height="0" width="0" style={{ position: "absolute" }}>
      <defs>
        <linearGradient id="aionit-sig-beam" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#94b4df" />
          <stop offset=".35" stopColor="#b5a5db" />
          <stop offset=".68" stopColor="#df839e" />
          <stop offset="1" stopColor="#edc3af" />
        </linearGradient>
        <filter height="300%" id="aionit-sig-glow" width="300%" x="-100%" y="-100%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <linearGradient id="aionit-sig-ribbonColor" x1="0" x2="1" y1="0" y2=".5">
          <stop stopColor="#b6c7e3" />
          <stop offset=".35" stopColor="#d7c9ec" />
          <stop offset=".67" stopColor="#dd96ae" />
          <stop offset="1" stopColor="#f0c9b9" />
        </linearGradient>
        <linearGradient id="aionit-sig-shieldColor" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#f6efff" />
          <stop offset=".4" stopColor="#c7aedf" />
          <stop offset="1" stopColor="#9477b6" />
        </linearGradient>
        <linearGradient id="aionit-sig-networkColor" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#78b5bd" />
          <stop offset=".5" stopColor="#c19dcc" />
          <stop offset="1" stopColor="#7e9bcf" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** 장면 1: 교재 · 코드 · 결과 */
function SceneWorkspace({ hidden }: { hidden: boolean }) {
  return (
    <section
      aria-label="교재와 실습: 읽은 지식이 실행 경험으로 이어지는 모습"
      className="hs-scene"
      hidden={hidden}
    >
      <div className="hs-scene-heading">
        <span>01 / YOUR LEARNING SPACE</span>
        <h2>
          읽은 지식이,
          <br />
          작동하는 경험이 되는 곳.
        </h2>
      </div>
      <span aria-hidden="true" className="hs-ghost-word">
        MAKE IT REAL.
      </span>
      <svg aria-hidden="true" className="hs-orbital" viewBox="0 0 580 450">
        <ellipse
          className="hs-orbit-track"
          cx="290"
          cy="235"
          rx="266"
          ry="142"
          transform="rotate(-23 290 235)"
        />
        <ellipse
          className="hs-orbit-track"
          cx="290"
          cy="235"
          rx="252"
          ry="164"
          transform="rotate(18 290 235)"
        />
        <path
          className="hs-orbit-glow"
          d="M50 330C-10 214 130 58 330 95S620 300 472 378C385 424 279 394 240 344"
        />
        <path
          className="hs-orbit-line"
          d="M50 330C-10 214 130 58 330 95S620 300 472 378C385 424 279 394 240 344"
        />
        <circle className="hs-orbit-point" cx="50" cy="330" r="5" />
        <circle className="hs-orbit-point" cx="472" cy="378" r="5" />
      </svg>
      <article className="hs-book">
        <span className="hs-book-brand">AIONIT / FIELD GUIDE</span>
        <div className="hs-book-num">04</div>
        <svg
          aria-hidden="true"
          className="hs-book-drawing"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 100 100"
        >
          <path d="M50 7 91 31v45L50 99 9 76V31Z M9 31l41 24 41-24M50 55v44M29 20l42 24v44M71 20 29 44v44" />
          <circle cx="50" cy="55" fill="#fff" r="5" />
        </svg>
        <h3>
          도구를 연결하는
          <br />
          AI Agent
        </h3>
        <div className="hs-book-footer">
          <span>READ. UNDERSTAND.</span>
          <span>↗</span>
        </div>
      </article>
      <article aria-label="실습 코드 장면" className="hs-code-window">
        <div className="hs-window-top">
          <span className="hs-window-dots">
            <i />
            <i />
            <i />
          </span>
          <span>agent.py</span>
          <span>PYTHON</span>
        </div>
        <pre>
          <span className="hs-comment"># 배운 개념을, 실행 가능한 코드로</span>
          {"\n"}
          <span className="hs-purple">agent</span> = Agent(tools){"\n"}
          <span className="hs-purple">agent</span>.<span className="hs-cyan">run</span>({"\n"}
          {"  "}
          <span className="hs-pink">&quot;서버 상태를 확인해 줘&quot;</span>
          {"\n"})
        </pre>
        <div className="hs-window-status">
          <i />
          FROM UNDERSTANDING TO ACTION
        </div>
      </article>
      <div className="hs-result">
        <span className="hs-result-icon">✓</span>
        <div>
          <small>YOUR FIRST RESULT</small>
          <strong>서버가 정상 응답합니다.</strong>
        </div>
      </div>
      <div className="hs-question-tag">
        <span>?</span>막힌 곳에서는, 교재 옆 Q&amp;A.
      </div>
      <span className="hs-scene-legend">교재 · 실습 · 질문 / 학습 장면 예시</span>
    </section>
  );
}

const RIBBON = "M-15 245C50 355 185 380 265 271S455 12 590 113";

/** 장면 2: 읽고 · 실행하고 · 내 실력으로 */
function SceneJourney({ hidden }: { hidden: boolean }) {
  return (
    <section
      aria-label="학습 과정: 이해하고 실행하고 내 실력으로 만드는 단계"
      className="hs-scene"
      hidden={hidden}
    >
      <div className="hs-scene-heading">
        <span>02 / TURN KNOWLEDGE INTO SKILL</span>
        <h2>
          이해에서 실행까지.
          <br />한 단계씩, 내 실력으로.
        </h2>
      </div>
      <span aria-hidden="true" className="hs-ghost-word">
        BUILD YOUR NEXT.
      </span>
      <svg aria-hidden="true" className="hs-ribbon" viewBox="0 0 580 420">
        <path
          d={RIBBON}
          fill="none"
          filter="url(#aionit-sig-glow)"
          opacity=".2"
          stroke="#d8d9ec"
          strokeWidth="46"
        />
        <path d={RIBBON} fill="none" opacity=".82" stroke="url(#aionit-sig-ribbonColor)" strokeWidth="25" />
        <path
          d="M-15 236C50 346 185 371 265 262S455 3 590 104"
          fill="none"
          opacity=".9"
          stroke="#fff"
          strokeWidth="1.5"
        />
        <path
          d="M-15 259C50 369 185 394 265 285S455 26 590 127"
          fill="none"
          opacity=".4"
          stroke="#ad91bc"
          strokeWidth="1"
        />
      </svg>
      <div className="hs-learning-plinth">
        <article className="hs-plinth">
          <span>01 / READ</span>
          <svg aria-hidden="true" viewBox="0 0 90 100">
            <path
              d="M9 20q20-10 36 0 16-10 36 0v60q-20-10-36 0-16-10-36 0Z"
              fill="#fbfcff"
              stroke="#9fb2d0"
              strokeWidth="1.5"
            />
            <path
              d="M45 20v60M18 33l19 1M18 44l19 1M18 55l14 1M53 34l19-1M53 45l19-1M53 56l13-1"
              fill="none"
              stroke="#a2b5d0"
              strokeWidth="2"
            />
            <path d="M11 84q18-10 34 0 16-10 34 0" fill="none" stroke="#9bb1cd" strokeWidth="3" />
          </svg>
          <h3>개념을 읽고</h3>
        </article>
        <article className="hs-plinth">
          <span>02 / BUILD</span>
          <div aria-hidden="true" className="hs-plinth-code">
            {"{ }"}
          </div>
          <h3>직접 실행하고</h3>
        </article>
        <article className="hs-plinth">
          <span>03 / OWN</span>
          <div aria-hidden="true" className="hs-plinth-complete">
            ✓
          </div>
          <h3>내 실력으로</h3>
        </article>
      </div>
      <div className="hs-journey-caption">
        머릿속에 머물던 지식이
        <strong>
          내 손으로 만든 <span>결과</span>가 되도록.
        </strong>
      </div>
      <span className="hs-scene-legend">READ → BUILD → OWN</span>
    </section>
  );
}

/** 장면 3: 인프라 · 보안 · AI 연결 */
function SceneConnected({ hidden }: { hidden: boolean }) {
  return (
    <section
      aria-label="연결된 실무: 인프라 보안 AI를 연결해 문제를 해결하는 모습"
      className="hs-scene"
      hidden={hidden}
    >
      <div className="hs-scene-heading">
        <span>03 / CONNECT YOUR SKILLS</span>
        <h2>
          기술은 연결될 때,
          <br />더 큰 가능성이 됩니다.
        </h2>
      </div>
      <span aria-hidden="true" className="hs-ghost-word">
        CONNECT &amp; BUILD.
      </span>
      <svg aria-hidden="true" className="hs-network" viewBox="0 0 580 430">
        <ellipse cx="290" cy="250" fill="none" rx="258" ry="142" stroke="#d2d9e8" strokeWidth="1" />
        <path
          className="hs-network-line"
          d="M105 205 295 82 470 260 105 205 M295 82 290 260 105 205 M290 260l180 0"
        />
        <path className="hs-network-lit" d="M105 205Q130 70 295 82T470 260" />
        <circle cx="105" cy="205" fill="#e7f5f3" r="6" stroke="#82abb3" />
        <circle cx="295" cy="82" fill="#f2e9fa" r="6" stroke="#b094ca" />
        <circle cx="470" cy="260" fill="#e6edfa" r="6" stroke="#7996c4" />
        <path d="M64 279h42M85 258v42M455 105h31M470 90v31" stroke="#c8d4e4" />
      </svg>
      <article className="hs-skill-node hs-server-node">
        <div aria-hidden="true" className="hs-server-tower">
          <i />
          <i />
          <i />
        </div>
        <h3>시스템을 세우고</h3>
        <p>INFRASTRUCTURE</p>
      </article>
      <article className="hs-skill-node hs-security-node">
        <svg aria-hidden="true" viewBox="0 0 110 130">
          <path d="M15 23 58 7l43 16v39c0 32-43 61-43 61S15 94 15 62Z" fill="#8e70ad" />
          <path
            d="M8 17 51 1l43 16v39c0 32-43 61-43 61S8 88 8 56Z"
            fill="url(#aionit-sig-shieldColor)"
            stroke="#f8efff"
            strokeWidth="1.5"
          />
          <path
            d="M19 25 51 13l32 12v30c0 22-32 47-32 47S19 77 19 55Z"
            fill="none"
            opacity=".65"
            stroke="#eee1ff"
          />
          <path
            d="m34 54 12 12 23-26"
            fill="none"
            stroke="#fff"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="5"
          />
        </svg>
        <h3>위험을 발견하고</h3>
        <p>SECURITY</p>
      </article>
      <article className="hs-skill-node hs-ai-node">
        <div className="hs-ai-orb">
          <svg aria-hidden="true" viewBox="0 0 70 70">
            <path
              d="M35 6C35 25 25 35 6 35c19 0 29 10 29 29 0-19 10-29 29-29-19 0-29-10-29-29Z"
              fill="currentColor"
            />
            <path d="m56 5 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#c1d1f4" />
          </svg>
        </div>
        <h3>반복을 자동화하고</h3>
        <p>AI ENGINEERING</p>
      </article>
      <div className="hs-network-center">
        <span>AIONIT</span>
        <strong>연결해서 해결하다</strong>
      </div>
      <div className="hs-network-result">
        기반을 이해하는 힘에서<b>현장의 문제를 해결하는 힘으로.</b>
      </div>
      <span className="hs-scene-legend">BUILD → PROTECT → AUTOMATE</span>
    </section>
  );
}
