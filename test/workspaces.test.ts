import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadWorkspaceRegistry,
  registrationBelongsToProject,
  saveWorkspaceRegistration,
} from "../src/state/workspaces.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("workspace registry", () => {
  it("round-trips private thread workspace metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-agent-view-registry-"));
    temporaryDirectories.push(root);
    const path = join(root, "nested", "workspaces.json");
    const registration = {
      threadId: "thread-1",
      sourceCwd: "/repo",
      taskCwd: "/worktrees/task",
      worktreePath: "/worktrees/task",
      createdAt: 123,
    };

    await saveWorkspaceRegistration(registration, path);

    const registry = await loadWorkspaceRegistry(path);
    expect(registry.registrations["thread-1"]).toEqual(registration);
    expect(registrationBelongsToProject(registry.registrations["thread-1"], "/repo")).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1 });
  });

  it("returns an empty registry for missing or incompatible files", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-agent-view-registry-"));
    temporaryDirectories.push(root);
    await expect(loadWorkspaceRegistry(join(root, "missing.json"))).resolves.toEqual({
      version: 1,
      registrations: {},
    });
  });

  it("preserves concurrent production registrations in per-thread files", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-agent-view-registry-"));
    temporaryDirectories.push(root);
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    try {
      const registrations = Array.from({ length: 12 }, (_, index) => ({
        threadId: `thread-${index}`,
        sourceCwd: "/repo",
        taskCwd: `/worktrees/task-${index}`,
        worktreePath: `/worktrees/task-${index}`,
        createdAt: index,
      }));

      await Promise.all(registrations.map((registration) =>
        saveWorkspaceRegistration(registration)
      ));

      const registry = await loadWorkspaceRegistry();
      expect(Object.keys(registry.registrations)).toHaveLength(registrations.length);
      const directory = join(root, "agent-view", "workspaces");
      expect(await readdir(directory)).toHaveLength(registrations.length);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect(registrationBelongsToProject(
        registry.registrations["thread-0"],
        "/repo/packages/app",
      )).toBe(true);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });
});
