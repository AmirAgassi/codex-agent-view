import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION_PATTERN = /(?:codex-cli\s+)?([^\s]+)$/u;

export async function detectCodexVersion(command = "codex"): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    return stdout.trim().match(VERSION_PATTERN)?.[1] ?? stdout.trim() ?? "unknown";
  } catch {
    return "unavailable";
  }
}
