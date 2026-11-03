"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { authApi } from "@/lib/client-api";
import { SIGNUP_EMAIL_KEY } from "../signup-form";

export function ResendVerification() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setEmail(sessionStorage.getItem(SIGNUP_EMAIL_KEY) ?? "");
    } catch {
      /* 저장소를 못 쓰는 브라우저: 직접 입력 */
    }
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await authApi("/send-verification-email", { email, callbackURL: "/login?verified=1" });
    setBusy(false);
    setMessage(
      result.ok
        ? {
            tone: "done",
            text: "인증 메일을 다시 보냈습니다. 몇 분 안에 오지 않으면 스팸 메일함도 확인해 주세요.",
          }
        : { tone: "danger", text: result.error.message },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5 border-t border-line-strong pt-6">
      <h2 className="m-0 text-[19px] font-semibold tracking-[-0.02em]">메일이 오지 않았나요?</h2>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Field
        label="이메일"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value.trim())}
        required
      />
      <Button type="submit" variant="outline" disabled={busy || !email}>
        인증 메일 다시 보내기
      </Button>
      <p className="m-0 text-[15px] text-ink-2">
        인증을 마쳤다면 <Link href="/login">로그인</Link>
      </p>
    </form>
  );
}
