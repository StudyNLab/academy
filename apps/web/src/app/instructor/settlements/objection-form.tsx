"use client";

// I-08 이의 신청 (명세 공개 뒤 5일). 운영자에게 알림이 가고, 답변은 이 화면에 보인다
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, inputClass, Notice } from "@aionit/ui";
import { api } from "@/lib/client-api";

export function ObjectionForm({ month, until }: { month: string; until: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);
  return (
    <form
      className="flex max-w-[720px] flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        const result = await api(`/instructor/settlements/${month}/objection`, { body });
        setBusy(false);
        if (!result.ok) {
          setMessage({ tone: "danger", text: result.error.message });
          return;
        }
        setBody("");
        setMessage({ tone: "done", text: "이의 신청을 보냈습니다. 운영자가 확인하고 답변합니다." });
        router.refresh();
      }}
    >
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink">무엇이 다른지 적어 주세요 ({until} 까지)</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={2000}
          className={`${inputClass} py-2.5`}
          placeholder="예: 12.03 판매가 빠진 것 같습니다."
          required
        />
      </label>
      <Button
        type="submit"
        variant="outline"
        disabled={busy || body.trim().length < 5}
        className="self-start"
      >
        이의 신청
      </Button>
    </form>
  );
}
