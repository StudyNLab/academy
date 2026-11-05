// P-02 강의 목록의 분야 · 검색 · 강사 · 정렬. 공개 강의 수가 적어 DB 대신 목록을 받아 거른다 (강의가 수백 개가 되면 쿼리로 옮긴다)
import type { CourseField } from "@aionit/db";
import { COURSE_FIELDS } from "@aionit/db";

export const CATALOG_SORTS = { recommended: "추천순", newest: "최신순", name: "이름순" } as const;
export type CatalogSort = keyof typeof CATALOG_SORTS;

export interface CatalogQuery {
  field?: CourseField;
  q?: string;
  instructor?: string;
  sort: CatalogSort;
}

interface Filterable {
  title: string;
  summary: string | null;
  field: CourseField;
  instructor: string;
  createdAt: Date;
}

/** 주소의 검색 조건 ➔ 알맞은 값만 (모르는 값은 버린다) */
export function parseCatalogQuery(params: Record<string, string | string[] | undefined>): CatalogQuery {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const field = one("field");
  const sort = one("sort");
  return {
    field: (COURSE_FIELDS as readonly string[]).includes(field ?? "") ? (field as CourseField) : undefined,
    q: one("q")?.slice(0, 100),
    instructor: one("instructor")?.slice(0, 100),
    sort: sort && sort in CATALOG_SORTS ? (sort as CatalogSort) : "recommended",
  };
}

/** 추천순은 받은 순서(운영자가 정한 순서) 그대로 */
export function filterCatalog<T extends Filterable>(items: T[], query: CatalogQuery): T[] {
  const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const found = items.filter((item) => {
    if (query.field && item.field !== query.field) return false;
    if (query.instructor && item.instructor !== query.instructor) return false;
    const text = `${item.title} ${item.summary ?? ""} ${item.instructor}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  if (query.sort === "newest") return found.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (query.sort === "name") return found.toSorted((a, b) => a.title.localeCompare(b.title, "ko"));
  return found;
}
