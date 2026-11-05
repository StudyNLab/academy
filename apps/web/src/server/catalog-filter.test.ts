import { describe, expect, it } from "vitest";
import { filterCatalog, parseCatalogQuery } from "./catalog-filter";

const course = (title: string, field: "ai" | "infra" | "security", instructor: string, day: number) => ({
  title,
  summary: `${title} 요약`,
  field,
  instructor,
  createdAt: new Date(2026, 0, day),
});
const items = [
  course("AI Agent 개발 · 초급", "ai", "홍길동", 1),
  course("리눅스 서버 운영", "infra", "김철수", 3),
  course("보안 관제 · Wazuh", "security", "홍길동", 2),
];
const titles = (list: { title: string }[]) => list.map((c) => c.title);

describe("parseCatalogQuery", () => {
  it("모르는 분야 · 정렬은 버린다", () => {
    expect(parseCatalogQuery({ field: "cooking", sort: "price" })).toEqual({
      field: undefined,
      q: undefined,
      instructor: undefined,
      sort: "recommended",
    });
  });
  it("앞뒤 공백을 지우고 빈 값은 없는 것으로", () => {
    expect(parseCatalogQuery({ field: "ai", q: "  agent ", instructor: " ", sort: "name" })).toEqual({
      field: "ai",
      q: "agent",
      instructor: undefined,
      sort: "name",
    });
  });
});

describe("filterCatalog", () => {
  it("조건이 없으면 받은 순서 그대로", () => {
    expect(titles(filterCatalog(items, { sort: "recommended" }))).toEqual(titles(items));
  });
  it("분야 · 강사", () => {
    expect(titles(filterCatalog(items, { field: "infra", sort: "recommended" }))).toEqual([
      "리눅스 서버 운영",
    ]);
    expect(titles(filterCatalog(items, { instructor: "홍길동", sort: "recommended" }))).toEqual([
      "AI Agent 개발 · 초급",
      "보안 관제 · Wazuh",
    ]);
  });
  it("검색: 낱말이 모두 제목 · 요약 · 강사 이름에 있어야 한다 (대소문자 무시)", () => {
    expect(titles(filterCatalog(items, { q: "agent", sort: "recommended" }))).toEqual([
      "AI Agent 개발 · 초급",
    ]);
    expect(titles(filterCatalog(items, { q: "홍길동 wazuh", sort: "recommended" }))).toEqual([
      "보안 관제 · Wazuh",
    ]);
    expect(filterCatalog(items, { q: "kubernetes", sort: "recommended" })).toEqual([]);
  });
  it("최신순 · 이름순", () => {
    expect(titles(filterCatalog(items, { sort: "newest" }))).toEqual([
      "리눅스 서버 운영",
      "보안 관제 · Wazuh",
      "AI Agent 개발 · 초급",
    ]);
    // 이름순은 한국어 순서: 한글 ➔ 영문
    expect(titles(filterCatalog(items, { sort: "name" }))).toEqual([
      "리눅스 서버 운영",
      "보안 관제 · Wazuh",
      "AI Agent 개발 · 초급",
    ]);
  });
});
