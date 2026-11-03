import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export { schema };

/** DB 연결을 만든다. 앱 전체에서 하나만 만들어 같이 쓴다. */
export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10, connection: { TimeZone: "UTC" } });
  return { db: drizzle(client, { schema, casing: "snake_case" }), close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>["db"];
