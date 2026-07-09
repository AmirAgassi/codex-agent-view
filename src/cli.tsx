#!/usr/bin/env node

import { render, type Instance } from "ink";

import { AgentViewApp, type AppOutcome } from "./app.js";
import { HELP_TEXT, VERSION, parseCliOptions, type CliOptions } from "./cli-options.js";
import { attachToThread, CodexClient, detectCodexVersion } from "./codex/index.js";
import { loadPreferences } from "./state/preferences.js";

async function runDashboard(
  options: CliOptions,
  codexVersion: string,
): Promise<AppOutcome> {
  const preferences = await loadPreferences();
  const client = new CodexClient({ cwd: options.cwd });

  let instance: Instance | undefined;
  let outcome: AppOutcome = { type: "exit" };
  let settled = false;
  const onDone = (next: AppOutcome): void => {
    if (settled) return;
    settled = true;
    outcome = next;
    instance?.unmount();
  };

  instance = render(
      <AgentViewApp
        client={client}
        options={options}
        initialPreferences={preferences}
        codexVersion={codexVersion}
        onDone={onDone}
      />,
      {
        exitOnCtrlC: false,
        patchConsole: false,
        alternateScreen: true,
      },
  );

  try {
    await instance.waitUntilExit();
    return outcome;
  } finally {
    client.close();
  }
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliOptions(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${HELP_TEXT}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("codex-agents requires an interactive terminal");
  }

  const codexVersion = await detectCodexVersion();
  let running = true;
  while (running) {
    const outcome = await runDashboard(options, codexVersion);

    if (outcome.type === "exit") {
      running = false;
      continue;
    }

    try {
      const exitCode = await attachToThread(outcome.threadId, { cwd: outcome.cwd });
      if (exitCode !== 0) {
        process.stderr.write(`Codex attach exited with status ${exitCode}\n`);
      }
    } catch (error) {
      process.stderr.write(
        `Could not open native Codex: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`codex-agents: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
