import { describe, expect, it } from "vitest";
import { safeNext } from "./next-url";

describe("safeNext", () => {
  it.each([
    ["/my", "/my"],
    ["/admin/users?q=kim", "/admin/users?q=kim"],
    [null, "/"],
    ["", "/"],
    ["https://evil.example/", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/my\nSet-Cookie: x", "/"],
  ])("%s ➔ %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
