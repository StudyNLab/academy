import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

// 채운 버튼은 한 화면에 하나 (docs/디자인시스템.md 4장)
type Variant = "primary" | "outline" | "danger";
type Size = "lg" | "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-ui border font-semibold no-underline transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:border-line disabled:bg-line disabled:text-ink-2";

const variants: Record<Variant, string> = {
  primary: "border-primary bg-primary text-on-primary hover:opacity-90",
  outline: "border-primary bg-transparent text-primary hover:bg-sunken",
  danger: "border-danger bg-danger text-white hover:opacity-90",
};

const sizes: Record<Size, string> = {
  lg: "min-h-[52px] px-7 text-base",
  md: "min-h-11 px-5 text-[15px]",
  sm: "min-h-9 px-3.5 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim();
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
      className={`inline-flex min-h-11 items-center gap-2.5 border-b border-ink font-semibold text-ink no-underline hover:text-signal ${className}`}
      {...rest}
    >
      {children} <span aria-hidden="true">→</span>
    </a>
  );
}
