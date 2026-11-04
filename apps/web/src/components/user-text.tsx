// 회원이 쓴 글(Q&A · 1:1 문의) 보여 주기. HTML 은 그대로 넣지 않는다 (React 가 글자를 이스케이프).
// 지원: ``` 로 감싼 코드 블록, `한 줄 코드`, 줄바꿈 · 빈 줄 문단. 그 밖의 마크다운 기호는 글자 그대로 보인다.
import type { ReactNode } from "react";
import { formatDay } from "./commerce/format";

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`)/g).map((part, i) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} className="rounded-sm bg-sunken px-1 py-0.5 font-mono text-[0.9em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

type Block = { kind: "code"; lang: string; text: string } | { kind: "text"; text: string };

export function splitBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let text: string[] = [];
  const flushText = () => {
    const joined = text.join("\n").trim();
    if (joined) for (const p of joined.split(/\n\s*\n/)) blocks.push({ kind: "text", text: p.trim() });
    text = [];
  };
  while (i < lines.length) {
    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(lines[i]!);
    if (fence) {
      flushText();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      i += 1; // 닫는 ``` (없으면 끝까지 코드)
      blocks.push({ kind: "code", lang: fence[1] ?? "", text: code.join("\n") });
      continue;
    }
    text.push(lines[i++]!);
  }
  flushText();
  return blocks;
}

export function UserText({ source, className = "" }: { source: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-3 text-[15px] leading-[1.75] break-words ${className}`}>
      {splitBlocks(source).map((block, i) =>
        block.kind === "code" ? (
          <pre
            key={i}
            className="m-0 overflow-x-auto rounded-ui border border-line bg-sunken px-3.5 py-3 font-mono text-[13px] leading-[1.6]"
            aria-label={block.lang ? `${block.lang} 코드` : "코드"}
          >
            <code>{block.text}</code>
          </pre>
        ) : (
          <p key={i} className="m-0 whitespace-pre-line">
            {inline(block.text)}
          </p>
        ),
      )}
    </div>
  );
}

const relative = new Intl.RelativeTimeFormat("ko-KR", { numeric: "auto" });

/** "3분 전" · "2일 전", 30일이 넘으면 날짜 */
export function timeAgo(value: Date | string, now = Date.now()): string {
  const diff = (new Date(value).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "방금";
  if (abs < 3600) return relative.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(diff / 3600), "hour");
  if (abs < 30 * 86_400) return relative.format(Math.round(diff / 86_400), "day");
  return formatDay(new Date(value));
}
