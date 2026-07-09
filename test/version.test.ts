import { describe, expect, it } from "vitest";
import { detectCodexVersion } from "../src/codex/version.js";

describe("detectCodexVersion", () => {
  it("reads the installed Codex CLI version", async () => {
    await expect(detectCodexVersion()).resolves.toMatch(/^0\.\d+/u);
  });

  it("fails closed for a missing command", async () => {
    await expect(detectCodexVersion("definitely-not-a-codex-binary")).resolves.toBe(
      "unavailable",
    );
  });
});
