// 1:1 문의 글 · 답변 (회원 화면 · 운영자 화면 공통)
import { formatDayTime } from "@/components/commerce/format";
import { UserText } from "@/components/user-text";

export function InquiryThread({
  messages,
  memberLabel,
}: {
  messages: { id: string; authorRole: "member" | "operator"; body: string; createdAt: Date }[];
  memberLabel: string;
}) {
  return (
    <ol className="m-0 flex list-none flex-col gap-5 p-0">
      {messages.map((m) => (
        <li
          key={m.id}
          className={`flex flex-col gap-2 border-t pt-4 ${m.authorRole === "operator" ? "border-t-2 border-signal bg-surface px-4 pb-4" : "border-line"}`}
        >
          <p className="m-0 flex gap-2 text-[13px] text-ink-2">
            <strong className={`font-semibold ${m.authorRole === "operator" ? "text-signal" : "text-ink"}`}>
              {m.authorRole === "operator" ? "AIONIT 운영자" : memberLabel}
            </strong>
            <span>{formatDayTime(m.createdAt)}</span>
          </p>
          <UserText source={m.body} />
        </li>
      ))}
    </ol>
  );
}
