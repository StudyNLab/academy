import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

// 채운 버튼은 한 화면에 하나 (docs/디자인시스템.md 4장).
// 모양은 시안 AIONIT-Service 의 .btn (apps/web/src/app/site.css): primary 는 파란 그라데이션, outline 은 시안의 secondary.
type Variant = "primary" | "outline" | "danger";
type Size = "lg" | "md" | "sm";

const base = "btn no-underline disabled:cursor-not-allowed disabled:opacity-55 disabled:transform-none";

const variants: Record<Variant, string> = {
  primary: "primary",
  outline: "secondary",
  danger: "danger",
};

// lg = 시안 기본 (50px · 16px), md = 시안 small (44px · 15px), sm = 표 · 목록 안의 작은 버튼
const sizes: Record<Size, string> = {
  lg: "",
  md: "small",
  sm: "min-h-9 gap-1.5 px-3.5 py-1.5 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`.replace(/\s+/g, " ").trim();
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export function Button({ variant, size, className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size };

/** 버튼처럼 보이는 링크. 화면 이동은 이것을 쓴다. */
export function LinkButton({ variant, size, className = "", ...rest }: LinkButtonProps) {
  return <a className={buttonClass(variant, size, className)} {...rest} />;
}

/** 글 링크 + 화살표 (보조 행동) */
export function TextLink({ className = "", children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={`group inline-flex min-h-11 items-center gap-2.5 border-b border-ink font-semibold text-ink no-underline hover:text-signal ${className}`}
      {...rest}
    >
      {children}{" "}
      <span aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-1">
        →
      </span>
    </a>
  );
}
