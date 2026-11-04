import "server-only";
import type { CourseDeps } from "./courses";
import { getDb } from "./db";
import { enqueueContent, enqueueVideo } from "./queue";
import { getMediaStore, getStore } from "./storage";
import type { VideoDeps } from "./videos";

export function courseDeps(): CourseDeps {
  return { db: getDb(), store: getStore(), enqueueContent };
}

export function videoDeps(): VideoDeps {
  return { db: getDb(), store: getStore(), media: getMediaStore(), enqueueVideo };
}
