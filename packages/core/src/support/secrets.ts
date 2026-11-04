// 질문 · 답변 · 문의에 붙여 넣은 API 키 찾기 (docs/화면상세기획.md 1.6, 데이터모델 3.9).
// 첫 강의가 LLM API 실습이라 키를 그대로 올리는 일이 잦다. 저장을 막지는 않고 한 번 더 확인받는다.

export interface SecretMatch {
  /** 어떤 키처럼 보이나 (화면에 보여 주는 이름) */
  kind: string;
  /** 앞 몇 글자만 남기고 가린 값 (어디에 있는지 찾도록) */
  masked: string;
}

const PATTERNS: { kind: string; pattern: RegExp }[] = [
  { kind: "Anthropic API 키", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "OpenAI API 키", pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "Google API 키", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "AWS 액세스 키", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "GitHub 토큰", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { kind: "Hugging Face 토큰", pattern: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { kind: "Groq API 키", pattern: /\bgsk_[A-Za-z0-9]{40,}\b/g },
  { kind: "Slack 토큰", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "비밀 키 파일", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
];

function mask(value: string): string {
  if (value.startsWith("-----")) return value;
  const keep = Math.min(8, Math.floor(value.length / 3));
  return `${value.slice(0, keep)}${"•".repeat(6)}`;
}

/** API 키처럼 보이는 글자들. 없으면 빈 배열 */
export function findSecrets(text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  const seen = new Set<string>();
  for (const { kind, pattern } of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      // sk-ant-… 는 OpenAI 규칙에도 걸린다: 한 번만
      if ([...seen].some((s) => s.includes(value) || value.includes(s))) continue;
      seen.add(value);
      found.push({ kind, masked: mask(value) });
    }
  }
  return found;
}
