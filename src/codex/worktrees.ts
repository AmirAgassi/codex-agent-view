import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const SAFE_SLUG = /[^a-z0-9]+/g;

export interface PreparedWorkspace {
  cwd: string;
  sourceCwd: string;
  worktreePath?: string;
}

export interface PrepareWorkspaceOptions {
  useWorktree: boolean;
  codexHome?: string;
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(SAFE_SLUG, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
  return slug || fallback;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function prepareWorkspace(
  sourceCwd: string,
  prompt: string,
  options: PrepareWorkspaceOptions,
): Promise<PreparedWorkspace> {
  const absoluteSource = resolve(sourceCwd);
  if (!(await isDirectory(absoluteSource))) {
    throw new Error(`Project directory does not exist: ${absoluteSource}`);
  }
  if (!options.useWorktree) {
    return { cwd: absoluteSource, sourceCwd: absoluteSource };
  }

  const canonicalSource = await realpath(absoluteSource);
  let repoRoot: string;
  try {
    repoRoot = await runGit(canonicalSource, ["rev-parse", "--show-toplevel"]);
  } catch {
    return { cwd: absoluteSource, sourceCwd: absoluteSource };
  }

  const subdirectory = relative(repoRoot, canonicalSource);
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const repoSlug = slugify(basename(repoRoot), "repo");
  const taskSlug = slugify(prompt, "task");
  const suffix = randomUUID().slice(0, 8);
  const parent = join(codexHome, "agent-view", "worktrees", repoSlug);
  const worktreePath = join(parent, `${taskSlug}-${suffix}`);

  await mkdir(parent, { recursive: true, mode: 0o700 });
  await runGit(repoRoot, ["worktree", "add", "--detach", worktreePath, "HEAD"]);

  const taskCwd = subdirectory ? join(worktreePath, subdirectory) : worktreePath;
  if (!(await isDirectory(taskCwd))) {
    throw new Error(`The matching worktree subdirectory does not exist: ${taskCwd}`);
  }

  return {
    cwd: taskCwd,
    sourceCwd: absoluteSource,
    worktreePath,
  };
}
