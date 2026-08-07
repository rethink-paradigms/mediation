/**
 * Mediation daemon — everliving process (production entry point).
 *
 * Starts hosted mediation with spawn-based engagement execution:
 *   - OW Worker runs in this process (lightweight: claim + spawn + wait).
 *   - Each engagement leaf runs in its own child process (Pi-isolated).
 *   - Child crash kills only that child; daemon + OW Worker stay alive.
 *
 * Run with:
 *   node --experimental-strip-types src/surfaces/daemon.ts
 *
 * Or add to package.json scripts:
 *   "daemon": "node --experimental-strip-types src/surfaces/daemon.ts"
 *
 * Configuration (environment variables):
 *   MEDIATION_DB_PATH         OW BackendSqlite path
 *                             (default: mediation-ow.sqlite in cwd)
 *   MEDIATION_JOIN_PATH       Join SQLite path
 *                             (default: <dirname(DB_PATH)>/mediation-join.sqlite)
 *   MEDIATION_PROJECT_ROOT    Pack / capability root (default: cwd)
 *   MEDIATION_USE_PI=1        Use Pi factory; else mock engine (default: false)
 *   MEDIATION_CONCURRENCY     OW Worker concurrency (default: 1)
 */

import path from "node:path";

import {
  createHostedMediation,
  defaultHostedJoinPath,
} from "../adapters/compose.ts";

// ── Configuration from environment ──────────────────────────────────────────

const DB_PATH =
  process.env["MEDIATION_DB_PATH"] ??
  path.join(process.cwd(), "mediation-ow.sqlite");

const JOIN_PATH =
  process.env["MEDIATION_JOIN_PATH"] ?? defaultHostedJoinPath(DB_PATH);

const PROJECT_ROOT =
  process.env["MEDIATION_PROJECT_ROOT"] ?? process.cwd();

const USE_PI = process.env["MEDIATION_USE_PI"] === "1";

const CONCURRENCY = process.env["MEDIATION_CONCURRENCY"] !== undefined
  ? Math.trunc(Number(process.env["MEDIATION_CONCURRENCY"]))
  : 1;

// ── Compose ──────────────────────────────────────────────────────────────────

process.stdout.write(
  `[mediation-daemon] starting  db=${DB_PATH}  pi=${String(USE_PI)}  concurrency=${String(CONCURRENCY)}\n`,
);

const { worker, stop } = createHostedMediation({
  dbPath: DB_PATH,
  joinPath: JOIN_PATH,
  projectRoot: PROJECT_ROOT,
  mockEngine: !USE_PI,
  concurrency: CONCURRENCY,
  spawnConfig: {
    joinPath: JOIN_PATH,
    projectRoot: PROJECT_ROOT,
    usePi: USE_PI,
  },
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`[mediation-daemon] ${signal} — shutting down\n`);
  try {
    await stop();
    process.stdout.write("[mediation-daemon] stopped\n");
  } catch (err) {
    process.stderr.write(
      `[mediation-daemon] stop error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT",  () => { void shutdown("SIGINT");  });

// ── Start ────────────────────────────────────────────────────────────────────

await worker.start();
process.stdout.write("[mediation-daemon] worker started — ready\n");

// Keep the process alive indefinitely.
await new Promise<never>(() => {});
