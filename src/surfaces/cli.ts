/**
 * Thin mediation CLI (S7 / ABS-B2) — surface talks SurfacePort only.
 *
 * Composition (createLocalMediation + createMediationSurface) wires the
 * adapter at the edge; engage path never touches factory / Presence directly.
 *
 * Usage:
 *   npm run mediation -- engage --agent <dir> --task "..."
 *   npm run mediation -- engage --agent <dir> --task "..." --resume <sessionRef>
 *   npm run mediation -- engage --agent <dir> --task "..." --project-root <packs root>
 *
 * Default mind: mock engine (no API keys). MEDIATION_CLI_PI=1 → Pi factory.
 */

import path from "node:path";


import { createLocalMediation } from "../adapters/compose.ts";
import { createMediationSurface } from "../adapters/surface/mediation-surface.ts";
import { asEngineKind, type EngineKind } from "../domain/engine.ts";
import { asSessionRef } from "../domain/presence.ts";
import type { SurfacePort } from "../ports/surface.ts";

export type CliArgs = {
  readonly command: "engage" | "help";
  readonly agentDir?: string;
  readonly task?: string;
  readonly resume?: string;
  readonly name?: string;
  readonly projectRoot?: string;
  readonly json?: boolean;
  /** Raw --engine value (validated in runCli → exit 2 on unknown kind). */
  readonly engine?: string;
};

export type RunCliOptions = {
  /**
   * Injected SurfacePort (tests). When omitted, CLI composes local
   * Mediation → createMediationSurface at the edge.
   */
  readonly surface?: SurfacePort;
};

export function parseArgs(argv: readonly string[]): CliArgs {
  const args = [...argv];
  const commandRaw = args[0] ?? "help";
  const command =
    commandRaw === "engage" || commandRaw === "help" ? commandRaw : "help";

  let agentDir: string | undefined;
  let task: string | undefined;
  let resume: string | undefined;
  let name: string | undefined;
  let projectRoot: string | undefined;
  let engine: string | undefined;
  let json = true;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    if (a === "--agent" && next) {
      agentDir = next;
      i++;
    } else if (a === "--task" && next) {
      task = next;
      i++;
    } else if (a === "--resume" && next) {
      resume = next;
      i++;
    } else if (a === "--name" && next) {
      name = next;
      i++;
    } else if (a === "--project-root" && next) {
      projectRoot = next;
      i++;
    } else if (a === "--engine" && next) {
      engine = next;
      i++;
    } else if (a === "--no-json") {
      json = false;
    }
  }

  return { command, agentDir, task, resume, name, projectRoot, json, engine };
}

export function printHelp(): string {
  return `mediation CLI (S7)

Commands:
  engage --agent <dir> --task <text> [--resume <sessionRef>] [--name <id>] [--project-root <dir>]

Options:
  --agent         Path to agent root (agent.yaml)
  --task          Engagement text
  --resume        SessionRef to rematerialize
  --name          Agent name override (default: basename of --agent)
  --project-root  Pack resolve root (default: agent dir)
  --engine        Runtime engine kind: pi | prime | mock (default: mock for
                  the CLI smoke path; see Env for Pi / engine selection)
  --no-json       Human-readable outcome (default: JSON on stdout)

Env:
  MEDIATION_CLI_ENGINE=pi|prime|mock  engine override (--engine flag wins)
  MEDIATION_CLI_PI=1                  legacy: use Pi factory composition
                                      (default: mock engine)
`;
}

function composeDefaultSurface(opts: {
  readonly projectRoot: string;
  readonly defaultEngine: EngineKind;
}): SurfacePort {
  const { mediation } = createLocalMediation({
    defaultEngine: opts.defaultEngine,
    projectRoot: opts.projectRoot,
    fsStoreOptions: {
      homeDir: path.join(opts.projectRoot, "_no_home"),
    },
  });
  return createMediationSurface(mediation);
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help" || !parsed.agentDir || !parsed.task) {
    console.error(printHelp());
    return parsed.command === "help" ? 0 : 2;
  }

  const agentDir = path.resolve(parsed.agentDir);
  const projectRoot = path.resolve(parsed.projectRoot ?? agentDir);
  const agentName = parsed.name ?? path.basename(agentDir);

  // S2e §3 — CLI engine precedence:
  //   --engine flag > MEDIATION_CLI_ENGINE env > MEDIATION_CLI_PI=1 ("pi") >
  //   definition/config > CLI smoke default "mock" (composition default).
  // Unknown --engine / env value → print help, exit 2 (fail-closed).
  let engineOverride: EngineKind | undefined;
  if (parsed.engine !== undefined) {
    try {
      engineOverride = asEngineKind(parsed.engine);
    } catch {
      console.error(printHelp());
      return 2;
    }
  } else {
    const envEngine = process.env.MEDIATION_CLI_ENGINE;
    if (envEngine !== undefined && envEngine !== "") {
      try {
        engineOverride = asEngineKind(envEngine);
      } catch {
        console.error(printHelp());
        return 2;
      }
    }
  }

  const legacyUsePi = process.env.MEDIATION_CLI_PI === "1";
  const surface =
    options.surface ??
    composeDefaultSurface({
      projectRoot,
      // CLI smoke default stays mock (no-keys local runs). The legacy Pi env
      // switches the composition default to pi; --engine / MEDIATION_CLI_ENGINE
      // travel as the per-call override (they beat everything downstream).
      defaultEngine: legacyUsePi ? "pi" : "mock",
    });

  const result = await surface.engageLocal({
    agent: { name: agentName, rootDir: agentDir },
    task: parsed.task,
    resume: parsed.resume ? asSessionRef(parsed.resume) : undefined,
    cwd: agentDir,
    channel: "cli",
    engine: engineOverride,
  });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`kind=${result.outcome.kind}`);
    console.log(`sessionRef=${result.sessionRef ?? ""}`);
    console.log(`packSnapshotHash=${result.packSnapshotHash ?? ""}`);
    console.log(`definitionId=${result.definitionId}`);
  }

  return result.outcome.kind === "failed" ? 1 : 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(import.meta.filename) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    const code = await runCli(process.argv.slice(2));
    process.exitCode = code;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}


