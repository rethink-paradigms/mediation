/**
 * Spawn-based engagement leaf executor (process isolation).
 *
 * createSpawnLeaf() returns an executeLeaf function suitable for injection
 * into EngagementArcDeps / PlanLeafDeps. When the arc or plan calls it,
 * a new Node child process is spawned to run the engagement leaf.
 *
 * Architecture role: the OW Worker process stays lightweight (claim + spawn +
 * wait). Each leaf — materialize → engage → dispose — runs in its own child.
 * If the child crashes (Pi OOM, SDK fault, unhandled rejection), only that
 * child dies. The OW Worker survives and reclaims the run when the lease
 * expires or retries via step.run retryPolicy.
 *
 * This is the mediation equivalent of runAgent() in platform/openworkflow.
 */

import { spawn } from "node:child_process";
import path from "node:path";

import type { EngineKind } from "../../domain/engine.ts";
import type {
  EngagementWorkflowInput,
  EngagementWorkflowOutput,
} from "./types.ts";

/** Absolute path to the engagement-runner child entry point. */
const RUNNER_PATH = path.resolve(
  import.meta.dirname,
  "../../surfaces/engagement-runner.ts",
);

// ── Configuration ────────────────────────────────────────────────────────────

export type SpawnLeafConfig = {
  /**
   * Absolute path to the JoinStore SQLite file.
   * Passed to the child so it can write join records.
   */
  readonly joinPath: string;
  /**
   * Project / capability root (for FsCapabilityStore resolution).
   * Passed to the child as --project-root.
   */
  readonly projectRoot?: string;
  /**
   * When true the child uses the Pi factory (real LLM sessions).
   * When false (default) the child uses the mock engine.
   * Legacy: maps to defaultEngine "pi" / "mock" when defaultEngine unset.
   */
  readonly usePi?: boolean;
  /**
   * Composition fallback engine passed to the child as --default-engine
   * (S2e). Explicit defaultEngine wins over the legacy usePi mapping.
   */
  readonly defaultEngine?: EngineKind;
};

/**
 * Resolve the child's composition default engine.
 * Precedence: explicit defaultEngine > legacy usePi:true → "pi" >
 * legacy usePi:false → "mock" > undefined (runner built-in fallback "pi").
 */
function resolveSpawnDefaultEngine(
  config: SpawnLeafConfig,
): EngineKind | undefined {
  if (config.defaultEngine !== undefined) return config.defaultEngine;
  if (config.usePi === true) return "pi";
  if (config.usePi === false) return "mock";
  return undefined;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build an executeLeaf function backed by child-process spawn.
 * Inject the returned function into EngagementArcDeps.executeLeaf or
 * PlanLeafDeps.executeLeaf at registration time.
 */
export function createSpawnLeaf(
  config: SpawnLeafConfig,
): (
  input: EngagementWorkflowInput,
  runId: string,
) => Promise<EngagementWorkflowOutput> {
  return (input, runId) => spawnEngagementLeaf(input, runId, config);
}

// ── Implementation ───────────────────────────────────────────────────────────

async function spawnEngagementLeaf(
  input: EngagementWorkflowInput,
  runId: string,
  config: SpawnLeafConfig,
): Promise<EngagementWorkflowOutput> {
  return new Promise<EngagementWorkflowOutput>((resolve, reject) => {
    const childArgs: string[] = [
      "--experimental-strip-types",
      RUNNER_PATH,
      "--join-path",
      config.joinPath,
      "--run-id",
      runId,
      "--input",
      JSON.stringify(input),
    ];
    if (config.projectRoot !== undefined) {
      childArgs.push("--project-root", config.projectRoot);
    }
    const defaultEngine = resolveSpawnDefaultEngine(config);
    if (defaultEngine !== undefined) {
      childArgs.push("--default-engine", defaultEngine);
    } else if (config.usePi === true) {
      // Legacy flag retained for external callers that invoke the runner
      // directly with --use-pi.
      childArgs.push("--use-pi");
    }

    const child = spawn(process.execPath, childArgs, {
      // stdin: ignore. stdout: piped (result JSON). stderr: inherit (logs visible).
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    });

    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        // No output — treat as failed engagement.
        resolve({
          kind: "failed",
          error: {
            message: `Engagement runner exited with code ${String(code)} and no output`,
            code: "RUNNER_NO_OUTPUT",
          },
        });
        return;
      }
      try {
        const result = JSON.parse(trimmed) as EngagementWorkflowOutput;
        resolve(result);
      } catch {
        resolve({
          kind: "failed",
          error: {
            message: `Engagement runner produced invalid JSON (exit code ${String(code)})`,
            code: "RUNNER_INVALID_OUTPUT",
          },
        });
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}
