import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface WorkspaceRegistration {
  threadId: string;
  sourceCwd: string;
  taskCwd: string;
  worktreePath?: string;
  createdAt: number;
}

export interface WorkspaceRegistry {
  version: 1;
  registrations: Record<string, WorkspaceRegistration>;
}

const EMPTY_REGISTRY: WorkspaceRegistry = { version: 1, registrations: {} };

export function getWorkspaceRegistryPath(): string {
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  return join(codexHome, "agent-view", "workspaces.json");
}

export function getWorkspaceRegistryDirectory(): string {
  return join(dirname(getWorkspaceRegistryPath()), "workspaces");
}

function emptyRegistry(): WorkspaceRegistry {
  return { ...EMPTY_REGISTRY, registrations: {} };
}

async function readLegacyRegistry(path: string): Promise<WorkspaceRegistry> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<WorkspaceRegistry>;
    if (value.version !== 1 || !value.registrations || typeof value.registrations !== "object") {
      return emptyRegistry();
    }
    return { version: 1, registrations: value.registrations };
  } catch {
    return emptyRegistry();
  }
}

function isRegistration(value: unknown): value is WorkspaceRegistration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const registration = value as Partial<WorkspaceRegistration>;
  return typeof registration.threadId === "string" &&
    typeof registration.sourceCwd === "string" &&
    typeof registration.taskCwd === "string" &&
    typeof registration.createdAt === "number";
}

export async function loadWorkspaceRegistry(
  path?: string,
): Promise<WorkspaceRegistry> {
  if (path !== undefined) return readLegacyRegistry(path);

  const registry = await readLegacyRegistry(getWorkspaceRegistryPath());
  try {
    const directory = getWorkspaceRegistryDirectory();
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(entries.flatMap((entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".json")) return [];
      return [readFile(join(directory, entry.name), "utf8")
        .then((contents) => JSON.parse(contents) as unknown)
        .then((value) => {
          if (isRegistration(value)) registry.registrations[value.threadId] = value;
        })
        .catch(() => undefined)];
    }));
    return registry;
  } catch {
    return registry;
  }
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporaryPath, contents, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function registrationFileName(threadId: string): string {
  return `${encodeURIComponent(threadId)}.json`;
}

export async function saveWorkspaceRegistration(
  registration: WorkspaceRegistration,
  path?: string,
): Promise<void> {
  if (path === undefined) {
    await writeAtomic(
      join(getWorkspaceRegistryDirectory(), registrationFileName(registration.threadId)),
      `${JSON.stringify(registration, null, 2)}\n`,
    );
    return;
  }

  // Keep the explicit-path form for callers/tests that need a portable single
  // file. Production uses per-thread files so concurrent dashboards cannot
  // overwrite one another's registrations.
  const registry = await readLegacyRegistry(path);
  registry.registrations[registration.threadId] = registration;
  await writeAtomic(path, `${JSON.stringify(registry, null, 2)}\n`);
}

function pathIsWithin(parent: string, child: string): boolean {
  const difference = relative(resolve(parent), resolve(child));
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

export function registrationBelongsToProject(
  registration: WorkspaceRegistration | undefined,
  projectCwd: string,
): boolean {
  if (!registration) return false;
  return pathIsWithin(registration.sourceCwd, projectCwd) ||
    pathIsWithin(projectCwd, registration.sourceCwd);
}
