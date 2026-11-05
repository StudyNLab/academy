// P-01 홈의 그림 · 고정 문구 부분. 시안 AIONIT-Service 의 app.js (heroArt · courseArt · diagramSVG · 학습 방식) 를 옮겼다.
// 그림은 꾸밈이라 화면 읽기 도구에는 한 줄 설명만 준다. 강의 · 요금 같은 데이터는 app/(public)/page.tsx 가 넣는다.
import type { CourseField } from "@aionit/db";
import { SvcIcon } from "./icons";

/** 첫 화면 오른쪽: 에이전트 코어 그림 + 모델 · 도구 표 + 코드 카드 */
export function HeroArt() {
  return (
    <div className="compute-art" role="img" aria-label="인프라 위에 도구와 AI 모델이 연결된 에이전트 코어">
      <div className="compute-top">
        <span>THE AIONIT STACK</span>
        <span>01 — BUILD</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- 벡터 그림이라 이미지 최적화가 필요 없다 */}
      <img className="core-illustration" src="/brand/agent-core.svg" alt="" />
      <div className="system-chip model-chip">
        <span className="chip-dot" /> MODEL <b>reason + act</b>
      </div>
      <div className="system-chip tools-chip">
        <span className="tool-braces">{"{ }"}</span>
        <span>TOOLS</span>
        <b>connect the real world</b>
      </div>
      <div className="terminal-card">
        <div className="terminal-head">
          <span>agent.py</span>
          <span>PYTHON</span>
        </div>
        <code>
          <span className="terminal-comment"># 아이디어를 실행 가능한 코드로</span>
          <br />
          <span className="terminal-blue">agent</span> = build_agent(tools)
          <br />
          agent.<span className="terminal-cyan">run</span>(
          <span className="terminal-string">&quot;What&apos;s next?&quot;</span>)
        </code>
        <div className="terminal-status">
          <span>↳</span> Your next skill starts here.
        </div>
      </div>
      <div className="compute-bottom">
        <span>INFRA / SECURITY / AI</span>
        <span>LEARN → BUILD → RUN</span>
      </div>
    </div>
  );
}

function DiagramSvg() {
  return (
    <svg viewBox="0 0 250 220" fill="none" aria-hidden="true">
      <path
        d="M46 111H205M125 35v150M50 44l151 134M50 180 200 44"
        stroke="#6491cf"
        strokeWidth="1"
        strokeDasharray="3 5"
      />
      <circle cx="125" cy="111" r="57" stroke="#a4c5ff" strokeWidth="1" />
      <circle cx="125" cy="111" r="42" stroke="#668cbd" />
      <path d="m125 77 30 17v34l-30 17-30-17V94z" fill="#9be8ff" />
      <path d="m125 77 30 17-30 18-30-18m30 18v33" stroke="#234d98" />
      <g fill="#11254c" stroke="#83abf1">
        <rect x="27" y="24" width="38" height="38" rx="5" />
        <rect x="183" y="24" width="38" height="38" rx="5" />
        <rect x="27" y="162" width="38" height="38" rx="5" />
        <rect x="183" y="162" width="38" height="38" rx="5" />
      </g>
      <g stroke="#9be8ff">
        <path d="m37 43 6 6 12-13M193 36h18m-18 7h14m-14 7h18M36 172h20v17H36zM194 172l-5 8 5 8m12-16 5 8-5 8" />
      </g>
    </svg>
  );
}

/** 분야별 영문 표기 · 표지 문구 (시안의 분야 띠 문구) */
export const FIELD_EN: Record<CourseField, { name: string; long: string; motto: [string, string] }> = {
  infra: { name: "INFRA", long: "INFRASTRUCTURE", motto: ["Build the", "foundation."] },
  security: { name: "SECURITY", long: "SECURITY", motto: ["Protect what", "matters."] },
  ai: { name: "AI", long: "AI", motto: ["Expand what's", "possible."] },
};

/** 대표 강의 표지: 격자 바탕 + 분야 문구 + 구조도. 시안은 "Build your first Agent." 고정 문구였다 */
export function CourseArt({ field, no, level }: { field: CourseField; no: number; level: string | null }) {
  const en = FIELD_EN[field];
  return (
    <div className="course-art" aria-hidden="true">
      <div className="art-grid" />
      <div className="course-art-top">
        <span>AIONIT / ENGINEERING LAB</span>
        <span>
          {en.name} / {String(no).padStart(3, "0")}
        </span>
      </div>
      <div className="course-art-title">
        {en.motto[0]}
        <br />
        {en.motto[1]}
        <small>
          {en.long}
          {level ? ` · ${level}` : ""}
        </small>
      </div>
      <div className="node-diagram">
        <DiagramSvg />
      </div>
    </div>
  );
}

/** 학습 방식: 읽고 → 만들어 보고 → 내 실력으로 */
export function MethodSection() {
  return (
    <section className="method-section" id="method">
      <div className="wrap section">
        <div className="method-intro">
          <div>
            <div className="eyebrow">LEARNING THAT STAYS WITH YOU</div>
            <h2>
              이해에서 실행까지,
              <br />
              하나로 이어지는 학습.
            </h2>
          </div>
          <p>
            실습의 맥락을 놓치지 않는 교재.
            <br />
            눈으로 확인하는 시연, 손으로 익히는 실습.
            <br />
            실무에 필요한 지식이 당신의 경험이 됩니다.
          </p>
        </div>
        <div className="method-grid">
          <article>
            <span className="method-num" data-topic="ai">
              01 / READ
            </span>
            <h3>맥락을 읽고</h3>
            <p>
              개념부터 명령어까지, 흐름이 있는 교재로
              <br />
              기술이 동작하는 이유를 이해합니다.
            </p>
            <div className="method-visual" aria-hidden="true">
              <span className="eyebrow">CHAPTER 04</span>
              <div className="fake-line short" />
              <div className="fake-line" />
              <div className="fake-line" />
              <div className="fake-line short" />
            </div>
          </article>
          <article>
            <span className="method-num" data-topic="infra">
              02 / BUILD
            </span>
            <h3>직접 만들어 보고</h3>
            <p>
              코드를 복사하고 실행하고 바꿔 보세요.
              <br />
              설명이 실제 동작으로 이어집니다.
            </p>
            <div className="method-visual" aria-hidden="true">
              <code>
                <span className="muted"># your next step</span>
                <br />
                result = agent.run()
                <br />
                print(result)
                <br />
                <br />
                &gt; Hello, Agent.
              </code>
            </div>
          </article>
          <article>
            <span className="method-num" data-topic="security">
              03 / MAKE IT YOURS
            </span>
            <h3>내 실력으로 남기고</h3>
            <p>
              실습 체크로 스스로 확인하고,
              <br />
              막힌 부분은 교재 옆에서 질문합니다.
            </p>
            <div className="method-visual" aria-hidden="true">
              <div className="check-row">
                <SvcIcon name="check" /> 도구 함수 정의하기
              </div>
              <div className="check-row">
                <SvcIcon name="check" /> 실행 결과 확인하기
              </div>
              <div className="check-row">
                <SvcIcon name="chat" /> 막힌 곳에서 질문하기
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
