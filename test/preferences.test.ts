import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES, type Preferences } from "../src/domain/types.js";
import {
  getPreferencesPath,
  loadPreferences,
  normalizePreferences,
  savePreferences,
} from "../src/state/preferences.js";

const cleanup: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codex-agent-view-preferences-"));
  cleanup.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("preferences", () => {
  it("builds the default path below a supplied home directory", () => {
    expect(getPreferencesPath("/Users/tester")).toBe(
      join("/Users/tester", ".codex", "agent-view", "preferences.json"),
    );
  });

  it("returns independent defaults when the file is absent", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "missing", "preferences.json");

    const first = await loadPreferences(path);
    first.order.push("mutated");
    const second = await loadPreferences(path);

    expect(second).toEqual(DEFAULT_PREFERENCES);
    expect(second.order).toEqual([]);
  });

  it("normalizes a partial v1 document and removes invalid or duplicate ids", () => {
    expect(normalizePreferences({
      version: 1,
      pinnedThreadIds: ["a", "a", 3, "", "b"],
      order: ["b", null, "a", "b"],
      groupBy: "cwd",
      defaultCwd: "/repo",
      showAllProjects: true,
      ignored: "field",
    })).toEqual({
      version: 1,
      pinnedThreadIds: ["a", "b"],
      order: ["b", "a"],
      groupBy: "cwd",
      defaultCwd: "/repo",
      showAllProjects: true,
    });
  });

  it("falls back for malformed JSON and unsupported versions", async () => {
    const directory = await temporaryDirectory();
    const malformed = join(directory, "malformed.json");
    const future = join(directory, "future.json");
    await writeFile(malformed, "{nope", "utf8");
    await writeFile(future, JSON.stringify({ version: 2, pinnedThreadIds: ["a"] }), "utf8");

    await expect(loadPreferences(malformed)).resolves.toEqual(DEFAULT_PREFERENCES);
    await expect(loadPreferences(future)).resolves.toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it("creates parent directories and atomically persists normalized preferences", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "deep", "agent-view", "preferences.json");
    const value: Preferences = {
      version: 1,
      pinnedThreadIds: ["one", "two"],
      order: ["two", "one"],
      groupBy: "state",
      defaultCwd: "/work/repo",
      showAllProjects: false,
    };

    await savePreferences(value, path);

    await expect(loadPreferences(path)).resolves.toEqual(value);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(value);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(directory, "deep", "agent-view"))).toEqual(["preferences.json"]);
  });

  it("replaces an existing file without leaving temporary files", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "preferences.json");
    const first: Preferences = {
      ...DEFAULT_PREFERENCES,
      pinnedThreadIds: ["first"],
      order: [],
    };
    const second: Preferences = {
      ...DEFAULT_PREFERENCES,
      pinnedThreadIds: ["second"],
      order: ["second"],
      showAllProjects: true,
    };

    await savePreferences(first, path);
    await savePreferences(second, path);

    await expect(loadPreferences(path)).resolves.toEqual(second);
    expect(await readdir(directory)).toEqual(["preferences.json"]);
  });

  it("never exposes partial JSON during concurrent atomic saves", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "preferences.json");
    const candidates: Preferences[] = Array.from({ length: 8 }, (_, index) => ({
      ...DEFAULT_PREFERENCES,
      pinnedThreadIds: [`thread-${index}`],
      order: [`thread-${index}`],
      showAllProjects: index % 2 === 0,
    }));

    await Promise.all(candidates.map((candidate) => savePreferences(candidate, path)));
    const saved = await loadPreferences(path);

    expect(candidates).toContainEqual(saved);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
