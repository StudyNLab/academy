import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export { schema };

/** DB 연결을 만든다. 앱 전체에서 하나만 만들어 같이 쓴다. */
export function createDb(url: string, options: { max?: number; quiet?: boolean } = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    connection: { TimeZone: "UTC" },
    // 마이그레이션의 "이미 있음, 건너뜀" 같은 안내(NOTICE)를 찍지 않는다
    ...(options.quiet ? { onnotice: () => {} } : {}),
  });
  return { db: drizzle(client, { schema, casing: "snake_case" }), close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>["db"];

// 쿼리 도우미. drizzle-orm 이 패키지마다 따로 깔리면 타입이 맞지 않으므로 여기서만 가져다 쓴다.
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
export type { LoginResult, PolicyKind, Role, UserStatus } from "./schema/index";
export { POLICY_KINDS, ROLES } from "./schema/index";
