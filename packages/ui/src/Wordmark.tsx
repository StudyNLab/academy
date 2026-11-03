// 임시 워드마크: AI + 전원 기호(O) + NIT (docs/디자인시스템.md 3장)

export function PowerIcon({ className, strokeWidth = 14 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <path d="M28 24 A38 38 0 1 0 72 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
      <path d="M50 6 V50" stroke="currentColor" strokeWidth={strokeWidth} />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="AIONIT"
      className={`inline-flex items-center font-bold tracking-[-0.04em] ${className}`}
    >
      <span aria-hidden="true">AI</span>
      <PowerIcon className="mr-[0.035em] ml-[0.05em] h-[0.74em] w-[0.74em] text-signal" />
      <span aria-hidden="true">NIT</span>
    </span>
  );
}
