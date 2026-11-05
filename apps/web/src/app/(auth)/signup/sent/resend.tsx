"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Button, Field, Notice } from "@aionit/ui";
import { SvcIcon } from "@/components/icons";
import { authApi } from "@/lib/client-api";
import { SIGNUP_EMAIL_KEY } from "../signup-form";

export function ResendVerification() {
  const [email, setEmail] = useState("");
  // 가입 화면에서 넘겨받은 주소가 있으면 글로 보여 주고, 없으면(다른 기기 · 저장소 막힘) 입력칸
  const [stored, setStored] = useState(false);
  const [message, setMessage] = useState<{ tone: "done" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SIGNUP_EMAIL_KEY) ?? "";
      setEmail(saved);
      setStored(Boolean(saved));
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
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="verification-visual" aria-hidden="true">
        <SvcIcon name="mail" />
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {stored ? (
        <p className="center m-0">
          인증 메일 받는 주소
          <br />
          <strong>{email}</strong>
        </p>
      ) : (
        <Field
          label="가입한 이메일"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value.trim())}
          required
        />
      )}
      <p className="field-hint center">
        메일이 없다면 스팸 메일함도 확인해 주세요.
        <br />
        인증 링크는 1시간이 지나면 만료됩니다.
      </p>
      <Link className="btn primary full" href="/login">
        인증을 마쳤어요 · 로그인
      </Link>
      <Button type="submit" variant="outline" disabled={busy || !email} className="full">
        인증 메일 다시 보내기
      </Button>
      <Link className="small-link center block" href="/signup">
        이메일 주소 다시 입력하기
      </Link>
    </form>
  );
}
