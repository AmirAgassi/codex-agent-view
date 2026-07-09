import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { prepareWorkspace } from "../src/codex/worktrees.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "codex-agent-view-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("prepareWorkspace", () => {
  it("returns the source directory in direct mode", async () => {
    const source = await makeTemporaryDirectory();
    await expect(
      prepareWorkspace(source, "direct task", { useWorktree: false }),
    ).resolves.toEqual({ cwd: source, sourceCwd: source });
  });

  it("falls back to the source directory outside Git", async () => {
    const source = await makeTemporaryDirectory();
    await expect(
      prepareWorkspace(source, "plain folder", {
        useWorktree: true,
        codexHome: join(source, ".codex-home"),
      }),
    ).resolves.toEqual({ cwd: source, sourceCwd: source });
  });

  it("creates a detached worktree for a Git project", async () => {
    const root = await makeTemporaryDirectory();
    const source = join(root, "project");
    const codexHome = join(root, "codex-home");
    await execFileAsync("git", ["init", "-b", "main", source]);
    await writeFile(join(source, "README.md"), "hello\n", "utf8");
    await execFileAsync("git", ["-C", source, "add", "README.md"]);
    await execFileAsync("git", [
      "-C",
      source,
      "-c",
      "user.name=Codex Agent View",
      "-c",
      "user.email=agent-view@example.invalid",
      "commit",
      "-m",
      "initial",
    ]);

    const workspace = await prepareWorkspace(source, "Fix the login flow", {
      useWorktree: true,
      codexHome,
    });

    expect(workspace.sourceCwd).toBe(source);
    expect(workspace.worktreePath).toContain(
      join(codexHome, "agent-view", "worktrees", "project", "fix-the-login-flow-"),
    );
    expect(await readFile(join(workspace.cwd, "README.md"), "utf8")).toBe("hello\n");
    const { stdout } = await execFileAsync("git", ["-C", source, "worktree", "list"]);
    expect(stdout).toContain(workspace.worktreePath);
  });
});
