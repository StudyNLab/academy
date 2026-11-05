// 정책 문서용 아주 작은 마크다운 표시기. HTML 을 그대로 넣지 않고(React 가 글자를 이스케이프) 블록만 나눈다.
// 지원: "## " · "### " 제목, 문단, "> " 인용(안내), "1. " 번호 목록, "- " 목록, "| " 표, **굵게**
import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
    );
}

export function SimpleMarkdown({ source }: { source: string }) {
  const blocks = source.trim().split(/\n\s*\n/);
  return (
    <div className="flex flex-col gap-5 text-[16px] leading-[1.85]">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const heading = lines.length === 1 ? /^(#{2,3})\s+(.+)$/.exec(lines[0]!) : null;
        if (heading) {
          return heading[1] === "##" ? (
            <h2 key={i} className="m-0 mt-4 text-[21px] font-semibold tracking-[-0.02em] text-ink">
              {inline(heading[2]!)}
            </h2>
          ) : (
            <h3 key={i} className="m-0 mt-2 text-[17px] font-semibold text-ink">
              {inline(heading[2]!)}
            </h3>
          );
        }
        if (lines.every((l) => l.startsWith(">"))) {
          return (
            <p key={i} className="m-0 border-t-2 border-warn bg-surface px-4 py-3 text-[14px] text-ink-2">
              {inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "))}
            </p>
          );
        }
        if (lines.every((l) => l.startsWith("|"))) {
          const rows = lines
            .filter((l) => !/^\|[\s|:-]+\|$/.test(l))
            .map((l) =>
              l
                .replace(/^\||\|$/g, "")
                .split("|")
                .map((c) => c.trim()),
            );
          const [head, ...body] = rows;
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-y-2 border-line-strong">
                    {head!.map((c, j) => (
                      <th key={j} className="px-3 py-2 text-left font-mono text-[12px] tracking-[0.04em]">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, r) => (
                    <tr key={r} className="border-b border-line">
                      {row.map((c, j) => (
                        <td key={j} className="px-3 py-2.5 align-top">
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (lines.every((l) => /^\d+\.\s/.test(l))) {
          return (
            <ol key={i} className="m-0 flex flex-col gap-1.5 pl-6">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\d+\.\s/, ""))}</li>
              ))}
            </ol>
          );
        }
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="m-0 flex flex-col gap-1.5 pl-6">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="m-0">
            {inline(lines.join(" "))}
          </p>
        );
      })}
    </div>
  );
}
