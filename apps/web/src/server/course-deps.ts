import "server-only";
import type { CourseDeps } from "./courses";
import { getDb } from "./db";
import { enqueueContent } from "./queue";
import { getStore } from "./storage";

export function courseDeps(): CourseDeps {
  return { db: getDb(), store: getStore(), enqueueContent };
}
