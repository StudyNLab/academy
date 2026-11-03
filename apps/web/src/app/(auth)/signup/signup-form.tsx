"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { checkNickname, checkPassword, NICKNAME_MESSAGES, PASSWORD_MESSAGES } from "@aionit/core";
import { Button, Checkbox, Field, Notice } from "@aionit/ui";
import { OrDivider, SocialButtons } from "@/components/social-buttons";
import { authApi, startSocial } from "@/lib/client-api";

export const SIGNUP_EMAIL_KEY = "aionit.signupEmail";

type Consents = { terms: boolean; privacy: boolean; age14: boolean; marketing: boolean };

export function SignupForm({
  policyTitles,
  providers,
}: {
  policyTitles: Record<string, string>;
  providers: ("google" | "kakao")[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [nickname, setNickname] = useState("");
  const [consents, setConsents] = useState<Consents>({
    terms: false,
    privacy: false,
    age14: false,
    marketing: false,
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allChecked = Object.values(consents).every(Boolean);
  const requiredChecked = consents.terms && consents.privacy && consents.age14;

  function setAll(value: boolean) {
    setConsents({ terms: value, privacy: value, age14: value, marketing: value });
  }

  async function checkNicknameRemote(value: string): Promise<string | null> {
    const local = checkNickname(value);
    if (local) return NICKNAME_MESSAGES[local];
    const response = await fetch(`/api/v1/nickname-available?nickname=${encodeURIComponent(value)}`);
    const data = (await response.json().catch(() => ({}))) as { available?: boolean; message?: string };
    return data.available ? null : (data.message ?? NICKNAME_MESSAGES.taken);
  }

  /** 소셜 가입도 같은 동의 · 닉네임을 먼저 받는다 */
  async function validateCommon(): Promise<boolean> {
    const next: Record<string, string | null> = { nickname: await checkNicknameRemote(nickname) };
    next.consents = requiredChecked ? null : "필수 항목에 동의해야 가입할 수 있습니다.";
    setErrors((prev) => ({ ...prev, ...next }));
    return !next.nickname && !next.consents;
  }

  const extras = () => ({
    nickname,
    age14: consents.age14,
    consents: { terms: consents.terms, privacy: consents.privacy, marketing: consents.marketing },
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const passwordProblem = checkPassword(password, { email, nickname });
    setErrors((prev) => ({
      ...prev,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "이메일 주소를 확인해 주세요.",
      password: passwordProblem ? PASSWORD_MESSAGES[passwordProblem] : null,
    }));
    const commonOk = await validateCommon();
    if (!commonOk || passwordProblem || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

    setBusy(true);
    const result = await authApi("/sign-up/email", {
      email,
      password,
      name: nickname,
      ...extras(),
      callbackURL: "/login?verified=1",
    });
    setBusy(false);
    if (!result.ok) {
      if (result.error.code === "NICKNAME_TAKEN" || result.error.code === "INVALID_NICKNAME") {
        setErrors((prev) => ({ ...prev, nickname: result.error.message }));
      } else if (result.error.code === "WEAK_PASSWORD") {
        setErrors((prev) => ({ ...prev, password: result.error.message }));
      } else {
        setFormError(result.error.message);
      }
      return;
    }
    // 인증 메일 다시 보내기에 쓴다. 주소창(URL)에는 이메일을 넣지 않는다.
    try {
      sessionStorage.setItem(SIGNUP_EMAIL_KEY, email);
    } catch {
      /* 저장소를 못 쓰는 브라우저 */
    }
    router.push("/signup/sent");
  }

  async function onSocial(provider: "google" | "kakao") {
    setFormError(null);
    if (!(await validateCommon())) return;
    setBusy(true);
    const error = await startSocial(provider, {
      callbackURL: "/",
      errorCallbackURL: "/signup",
      signup: extras(),
    });
    if (error) {
      setBusy(false);
      setFormError(error.message);
    }
  }

  const policyLink = (kind: string) => (
    <Link href={`/policies/${kind}`} target="_blank" className="ml-1 text-[13px] text-ink-2">
      보기
    </Link>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <Field
        label="이메일"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value.trim())}
        error={errors.email}
        required
      />
      <div className="flex flex-col gap-1.5">
        <Field
          label="비밀번호"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="8자 이상. 흔한 비밀번호 · 이메일이나 닉네임이 들어간 비밀번호는 쓸 수 없습니다."
          error={errors.password}
          required
        />
        <label className="flex min-h-11 items-center gap-2 self-start text-[13px] text-ink-2">
          <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
          비밀번호 보기
        </label>
      </div>
      <Field
        label="닉네임"
        autoComplete="nickname"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        onBlur={async () => {
          if (nickname) setErrors((prev) => ({ ...prev, nickname: null }));
          if (nickname) {
            const message = await checkNicknameRemote(nickname);
            setErrors((prev) => ({ ...prev, nickname: message }));
          }
        }}
        hint="강의 Q&A 에 보이는 이름입니다. 2 ~ 16자, 한글 · 영문 · 숫자 · 밑줄. 30일에 한 번 바꿀 수 있습니다."
        error={errors.nickname}
        required
      />

      <fieldset className="m-0 flex flex-col border-0 border-t border-line-strong p-0 pt-2">
        <legend className="sr-only">약관 동의</legend>
        <Checkbox checked={allChecked} onChange={(e) => setAll(e.target.checked)} className="font-semibold">
          모두 동의합니다
        </Checkbox>
        <div className="border-t border-line pl-1">
          <Checkbox
            checked={consents.terms}
            onChange={(e) => setConsents({ ...consents, terms: e.target.checked })}
          >
            [필수] {policyTitles.terms ?? "이용약관"}
            {policyLink("terms")}
          </Checkbox>
          <Checkbox
            checked={consents.privacy}
            onChange={(e) => setConsents({ ...consents, privacy: e.target.checked })}
          >
            [필수] {policyTitles.privacy ?? "개인정보 수집 · 이용 동의"}
            {policyLink("privacy")}
          </Checkbox>
          <Checkbox
            checked={consents.age14}
            onChange={(e) => setConsents({ ...consents, age14: e.target.checked })}
          >
            [필수] 만 14세 이상입니다
          </Checkbox>
          <Checkbox
            checked={consents.marketing}
            onChange={(e) => setConsents({ ...consents, marketing: e.target.checked })}
          >
            [선택] {policyTitles.marketing ?? "마케팅 정보 수신 동의"}
            {policyLink("marketing")}
          </Checkbox>
        </div>
        {errors.consents ? (
          <p role="alert" className="m-0 text-[13px] font-medium text-danger">
            <span aria-hidden="true">! </span>
            {errors.consents}
          </p>
        ) : null}
      </fieldset>

      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? "처리 중…" : "이메일로 가입하기"}
      </Button>

      {providers.length > 0 ? (
        <>
          <OrDivider />
          <SocialButtons providers={providers} verb="가입하기" onSelect={onSocial} disabled={busy} />
          <p className="m-0 text-[13px] leading-[1.6] text-ink-2">
            구글 · 카카오로 가입할 때도 위의 닉네임과 동의 항목을 씁니다. 이메일 · 비밀번호는 비워 두어도
            됩니다.
          </p>
        </>
      ) : null}

      <p className="m-0 text-[15px] text-ink-2">
        이미 가입했나요? <Link href="/login">로그인</Link>
      </p>
    </form>
  );
}
