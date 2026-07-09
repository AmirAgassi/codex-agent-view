import { open, mkdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { DEFAULT_PREFERENCES, type Preferences } from "../domain/types.js";

export const PREFERENCES_VERSION = 1 as const;

export function getPreferencesPath(homeDirectory?: string): string {
  const codexHome = homeDirectory
    ? join(homeDirectory, ".codex")
    : process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return join(codexHome, "agent-view", "preferences.json");
}

function defaults(): Preferences {
  return {
    ...DEFAULT_PREFERENCES,
    pinnedThreadIds: [],
    order: [],
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

export function normalizePreferences(value: unknown): Preferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return defaults();
  const record = value as Record<string, unknown>;
  if (record.version !== PREFERENCES_VERSION) return defaults();
  const defaultCwd = typeof record.defaultCwd === "string" && record.defaultCwd.trim() !== ""
    ? record.defaultCwd
    : undefined;
  return {
    version: PREFERENCES_VERSION,
    pinnedThreadIds: uniqueStrings(record.pinnedThreadIds),
    order: uniqueStrings(record.order),
    groupBy: record.groupBy === "cwd" ? "cwd" : "state",
    ...(defaultCwd === undefined ? {} : { defaultCwd }),
    showAllProjects: typeof record.showAllProjects === "boolean" ? record.showAllProjects : false,
  };
}

export async function loadPreferences(filePath = getPreferencesPath()): Promise<Preferences> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults();
    throw error;
  }

  try {
    return normalizePreferences(JSON.parse(contents) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) return defaults();
    throw error;
  }
}

export async function savePreferences(
  preferences: Preferences,
  filePath = getPreferencesPath(),
): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  const contents = `${JSON.stringify(normalizePreferences(preferences), null, 2)}\n`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
