import { CodexClient } from "./codex/index.js";

const client = new CodexClient({ cwd: process.cwd() });

try {
  const initialized = await client.connect();
  const page = await client.listThreads({
    limit: 1,
    sortKey: "updated_at",
    sourceKinds: ["cli", "vscode", "appServer"],
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      platform: initialized.platformOs,
      appServerReachable: true,
      hasSessions: page.data.length > 0,
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  client.close();
}
