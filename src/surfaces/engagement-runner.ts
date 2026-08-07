/**
 * Engagement runner — child-process entry point (process isolation).
 *
 * Spawned by adapters/openworkflow/spawn-leaf.ts for each engagement leaf.
 * Runs runEngagementLeaf in its own process; writes the EngagementWorkflowOutput
 * as JSON to stdout; exits with code 0 (settled/parked) or 1 (failed).
 *
 * If this process crashes (OOM, Pi SDK fault, unhandled rejection), only this
 * child dies. The OW Worker survives and can retry via step.run retryPolicy.
 *
 * Usage (spawned automatically — do not call directly):
 *   node --experimental-strip-types engagement-runner.ts \
 *     --join-path /data/mediation-join.sqlite \
 *     --run-id   run-abc123 \
 *     --input    '{"agentName":"...","agentRoot":"...","task":"..."}' \
 *     [--project-root /path/to/project] \
 *     [--default-engine pi|prime|mock]   (legacy: [--use-pi])
 */

import path from "node:path";

import { createEngineRegistry } from "../adapters/engine-registry.ts";
import { YamlDefinitionLoader } from "../adapters/definition/yaml-definition-loader.ts";
import { SqliteJoinStore } from "../adapters/join/sqlite-store.ts";
import { toPackSnapshot } from "../adapters/packs/pack-snapshot.ts";
import { runEngagementLeaf } from "../adapters/openworkflow/workflows/engagement.ts";
import { resolveCapabilityResolver } from "../adapters/wiring.ts";
import { DefaultPresenceFactory } from "../app/factory.ts";
import { asEngineKind, type EngineKind } from "../domain/engine.ts";
import { asRunId } from "../domain/engagement.ts";
import type { EngagementWorkflowInput } from "../adapters/openworkflow/types.ts";

// ── Arg parsing ──────────────────────────────────────────────────────────────

type RunnerArgs = {
  readonly joinPath: string;
  readonly runId: string;
  readonly input: EngagementWorkflowInput;
  readonly projectRoot: string | undefined;
  /** Composition fallback engine (--default-engine; legacy --use-pi maps). */
  readonly defaultEngine: EngineKind | undefined;
};

function parseArgs(argv: readonly string[]): RunnerArgs | string {
  let joinPath: string | undefined;
  let runId: string | undefined;
  let inputJson: string | undefined;
  let projectRoot: string | undefined;
  let defaultEngineRaw: string | undefined;
  let usePi = false;

  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    if (a === "--join-path" && next !== undefined) {
      joinPath = next;
      i++;
    } else if (a === "--run-id" && next !== undefined) {
      runId = next;
      i++;
    } else if (a === "--input" && next !== undefined) {
      inputJson = next;
      i++;
    } else if (a === "--project-root" && next !== undefined) {
      projectRoot = next;
      i++;
    } else if (a === "--default-engine" && next !== undefined) {
      defaultEngineRaw = next;
      i++;
    } else if (a === "--use-pi") {
      usePi = true;
    }
  }

  if (!joinPath) return "missing --join-path";
  if (!runId) return "missing --run-id";
  if (!inputJson) return "missing --input";

  let input: EngagementWorkflowInput;
  try {
    input = JSON.parse(inputJson) as EngagementWorkflowInput;
  } catch {
    return "invalid JSON in --input";
  }

  // S2e: --default-engine wins; legacy --use-pi maps to "pi".
  let defaultEngine: EngineKind | undefined;
  if (defaultEngineRaw !== undefined) {
    try {
      defaultEngine = asEngineKind(defaultEngineRaw);
    } catch {
      return `invalid --default-engine "${defaultEngineRaw}"`;
    }
  } else if (usePi) {
    defaultEngine = "pi";
  }

  return { joinPath, runId, input, projectRoot, defaultEngine };
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (typeof parsed === "string") {
    process.stderr.write(`engagement-runner: ${parsed}\n`);
    process.exitCode = 2;
    return;
  }

  const { joinPath, runId, input, projectRoot, defaultEngine } = parsed;

  // JoinStore: connects to the shared SQLite file (WAL mode enabled in constructor).
  const join = new SqliteJoinStore({ path: joinPath });

  // Definition loader: YAML-backed, resolves from agentRoot on disk.
  const loader = new YamlDefinitionLoader();

  // Capability root: explicit --project-root wins; otherwise the agent's own
  // rootDir is the natural pack/capability root (fixture agents carry their
  // extensions/tools). Never empty — an empty store makes every extension
  // fail-closed and no keyless spawn can settle.
  const effectiveProjectRoot = projectRoot ?? input.agentRoot;

  // S2e: registry-backed factory. The runner resolves engine from the
  // serialized input (input.engine), the definition's declared engine, and
  // --default-engine, inside DefaultPresenceFactory — replacing the old
  // `if (usePi) piFactory else mock` branch.
  //
  // IMPORTANT: the runner must NEVER read MEDIATION_CLI_ENGINE /
  // MEDIATION_CLI_PI (CLI-local env; spawn-leaf forwards process.env). The
  // leaf's engine comes only from the serialized workflow input + this
  // --default-engine composition value.
  const factory = new DefaultPresenceFactory({
    registry: createEngineRegistry(),
    defaultEngine,
    toPackSnapshot,
    capabilityResolver: resolveCapabilityResolver({
      projectRoot: effectiveProjectRoot,
    }),
  });

  const resolveDefinition = (inp: EngagementWorkflowInput) =>
    loader.load({
      name: inp.agentName,
      rootDir: inp.agentRoot ?? path.resolve(effectiveProjectRoot ?? process.cwd(), inp.agentName),
    });

  try {
    const outcome = await runEngagementLeaf(input, {
      factory,
      join,
      resolveDefinition,
      runId: asRunId(runId),
      defaultEngine,
    });

    join.close();
    process.stdout.write(JSON.stringify(outcome));
    process.exitCode = outcome.kind === "failed" ? 1 : 0;
  } catch (err) {
    try { join.close(); } catch {
      // ignore
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify({
        kind: "failed",
        error: { message, code: "RUNNER_UNHANDLED" },
      }),
    );
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(import.meta.filename) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`engagement-runner: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
