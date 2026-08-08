/**
 * Thin mediation CLI (S7 / ABS-B2 + LIFE-S1 runtime control) — surface talks
 * SurfacePort only.
 *
 * Composition (createLocalMediation + createMediationSurface) wires the
 * adapter at the edge; engage path never touches factory / Presence directly.
 *
 * Usage:
 *   npm run mediation -- engage --agent <dir> --task "..."
 *   npm run mediation -- engage --agent <dir> --task "..." --resume <sessionRef>
 *   npm run mediation -- dispatch --agent <dir> --task "..." [--wait]
 *   npm run mediation -- status --run-id <runId>
 *   npm run mediation -- wait --run-id <runId> [--timeout-ms <ms>]
 *   npm run mediation -- cancel --run-id <runId>
 *   npm run mediation -- wake --run-id <runId> --text "..."
 *
 * Default mind: mock engine (no API keys). MEDIATION_CLI_PI=1 → Pi factory.
 */

import path from "node:path";


import { createLocalMediation } from "../adapters/compose.ts";
import { createRuntimeClient } from "../adapters/openworkflow/host.ts";
import { createMediationSurface } from "../adapters/surface/mediation-surface.ts";
import { createIpcRuntimeClient, ensureDaemon } from "./ipc-client.ts";
import { asEngineKind, type EngineKind } from "../domain/engine.ts";
import { asSessionRef } from "../domain/presence.ts";
import type { SurfacePort } from "../ports/surface.ts";
import type { RuntimePort } from "../ports/runtime.ts";

/** Known CLI subcommands (engage + LIFE-S1 runtime control). */
export type CliCommand =
  | "engage"
  | "help"
  | "dispatch"
  | "status"
  | "wait"
  | "cancel"
  | "wake"
  | "unknown";

export type CliArgs = {
  readonly command: CliCommand;
  readonly agentDir?: string;
  readonly task?: string;
  readonly resume?: string;
  readonly name?: string;
  readonly projectRoot?: string;
  readonly json?: boolean;
  /** Raw --engine value (validated in runCli → exit 2 on unknown kind). */
  readonly engine?: string;
  /** LIFE-S1: durable run id for status/wait/cancel/wake. */
  readonly runId?: string;
  /** LIFE-S1: wake payload text (--text). */
  readonly text?: string;
  /** LIFE-S1: wake/engage mode (--mode prompt|continue). */
  readonly mode?: string;
  /** LIFE-S1: dispatch --wait / wake re-park flag. */
  readonly wait?: boolean;
  /** LIFE-S1: wait timeout (--timeout-ms). */
  readonly timeoutMs?: number;
  /** LIFE-S1: --park-intent flag + --park-reason text. */
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
  /** LIFE-S1: dispatch clientRequestId (--client-request-id). */
  readonly clientRequestId?: string;
  /** Phase-2 daemon IPC: talk to a running daemon over IPC (--ipc / MEDIATION_IPC). */
  readonly ipc?: string;
  /** Phase-2 daemon IPC: auto-spawn the daemon on first connect (--spawn). */
  readonly spawn?: boolean;
};

export type RunCliOptions = {
  /**
   * Injected SurfacePort (tests). When omitted, CLI composes local
   * Mediation → createMediationSurface at the edge.
   */
  readonly surface?: SurfacePort;
};

const KNOWN_COMMANDS: ReadonlySet<string> = new Set([
  "engage",
  "help",
  "dispatch",
  "status",
  "wait",
  "cancel",
  "wake",
]);

export function parseArgs(argv: readonly string[]): CliArgs {
  const args = [...argv];
  const commandRaw = args[0] ?? "help";
  const command: CliCommand = KNOWN_COMMANDS.has(commandRaw)
    ? (commandRaw as CliCommand)
    : "unknown";

  let agentDir: string | undefined;
  let task: string | undefined;
  let resume: string | undefined;
  let name: string | undefined;
  let projectRoot: string | undefined;
  let engine: string | undefined;
  let runId: string | undefined;
  let text: string | undefined;
  let mode: string | undefined;
  let wait: boolean | undefined;
  let timeoutMs: number | undefined;
  let parkIntent: boolean | undefined;
  let parkReason: string | undefined;
  let clientRequestId: string | undefined;
  let ipc: string | undefined;
  let spawn: boolean | undefined;
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
    } else if (a === "--run-id" && next) {
      runId = next;
      i++;
    } else if (a === "--text" && next) {
      text = next;
      i++;
    } else if (a === "--mode" && next) {
      mode = next;
      i++;
    } else if (a === "--timeout-ms" && next) {
      timeoutMs = Number(next);
      i++;
    } else if (a === "--client-request-id" && next) {
      clientRequestId = next;
      i++;
    } else if (a === "--ipc" && next) {
      ipc = next;
      i++;
    } else if (a === "--spawn") {
      spawn = true;
    } else if (a === "--park-intent") {
      parkIntent = true;
    } else if (a === "--park-reason" && next) {
      parkReason = next;
      i++;
    } else if (a === "--wait") {
      wait = true;
    } else if (a === "--no-json") {
      json = false;
    }
  }

  return {
    command,
    agentDir,
    task,
    resume,
    name,
    projectRoot,
    json,
    engine,
    runId,
    text,
    mode,
    wait,
    timeoutMs,
    parkIntent,
    parkReason,
    clientRequestId,
    ipc,
    spawn,
  };
}

export function printHelp(): string {
  return `mediation CLI (S7 / LIFE-S1)

Commands:
  engage --agent <dir> --task <text> [--resume <sessionRef>] [--name <id>] [--project-root <dir>] [--engine <kind>]
  dispatch --agent <dir> --task <text> [--name <id>] [--project-root <dir>] [--engine <kind>] [--wait] [--client-request-id <id>]
  status  --run-id <runId>
  wait    --run-id <runId> [--timeout-ms <ms>]
  cancel  --run-id <runId>
  wake    --run-id <runId> --text <payloadText> [--mode prompt|continue] [--park-intent] [--park-reason <text>]

Options:
  --agent             Path to agent root (agent.yaml)
  --task              Engagement text
  --resume            SessionRef to rematerialize
  --name              Agent name override (default: basename of --agent)
  --project-root      Pack resolve root (default: agent dir)
  --engine            Runtime engine kind: pi | prime | mock (default: mock for
                      the CLI smoke path; see Env for Pi / engine selection)
  --run-id            Durable run id (status/wait/cancel/wake)
  --text              Wake payload text
  --mode              Engage mode: prompt | continue (default: continue)
  --timeout-ms        Wait timeout in ms
  --wait              Dispatch: wait for terminal status after dispatch
  --park-intent       Wake: force re-park after continue (test/control)
  --park-reason       Human-readable park reason
  --client-request-id Dispatch correlation id
  --ipc <endpoint>    Talk to a running daemon over IPC (unix:/path.sock or
                      http://127.0.0.1:port; env: MEDIATION_IPC). Wins over
                      MEDIATION_DB_PATH sqlite-runtime-client mode.
  --spawn             Auto-spawn the daemon on first connect (--ipc mode;
                      env: MEDIATION_IPC_SPAWN=1)
  --no-json           Human-readable outcome (default: JSON on stdout)

Env:
  MEDIATION_CLI_ENGINE=pi|prime|mock  engine override (--engine flag wins)
  MEDIATION_CLI_PI=1                  legacy: use Pi factory composition
                                      (default: mock engine)
  MEDIATION_IPC=<endpoint>            daemon IPC endpoint (see --ipc)
  MEDIATION_IPC_SPAWN=1               auto-spawn daemon on first connect
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

/**
 * Runtime control surface (LIFE-S1): when MEDIATION_DB_PATH points at a
 * daemon's OW sqlite DB, status/wait/cancel/wake/dispatch ride a
 * worker-less runtime client (the daemon's worker claims runs). When the env
 * is absent, falls back to the local composition — runtime verbs then fail
 * with a clear "no RuntimePort" style error from the surface.
 */
function composeRuntimeSurface(opts: {
  readonly projectRoot: string;
  readonly defaultEngine: EngineKind;
  /**
   * Phase-2 daemon IPC: when set, runtime verbs ride the daemon IPC client
   * (unix:/path.sock or http://127.0.0.1:port). Wins over the
   * MEDIATION_DB_PATH sqlite-runtime-client mode.
   */
  readonly ipcEndpoint?: string;
  /** Phase-2 daemon IPC: spawn the daemon on first connect when true. */
  readonly spawnDaemon?: boolean;
}): { readonly surface: SurfacePort; readonly close?: () => Promise<void> } {
  const ipcEndpoint = opts.ipcEndpoint;
  if (ipcEndpoint !== undefined && ipcEndpoint !== "") {
    const client = createIpcRuntimeClient({ endpoint: ipcEndpoint });
    const surface = runtimeSurfaceFor(client.runtime);
    return { surface, close: () => client.stop() };
  }
  const dbPath = process.env.MEDIATION_DB_PATH;
  if (dbPath === undefined || dbPath === "") {
    return { surface: composeDefaultSurface(opts) };
  }
  const client = createRuntimeClient({ dbPath });
  const surface = runtimeSurfaceFor(client.runtime);
  return {
    surface,
    close: () => client.stop(),
  };
}

/**
 * Map a RuntimePort onto the SurfacePort runtime-verb face (LIFE-S1 /
 * phase-2 daemon IPC). Single mapping site shared by the sqlite runtime
 * client and the IPC client.
 */
function runtimeSurfaceFor(runtime: RuntimePort): SurfacePort {
  return {
    engageLocal() {
      return Promise.reject(
        new Error("mediation CLI: engageLocal is local-only (use the engage subcommand)"),
      );
    },
    dispatch(req) {
      return runtime.dispatch({
        agent: req.agent,
        task: req.task,
        resume: req.resume,
        clientRequestId: req.clientRequestId,
        parkIntent: req.parkIntent,
        parkReason: req.parkReason,
        engine: req.engine,
      });
    },
    getStatus(runId) {
      return runtime.getStatus(runId);
    },
    wait(runId, wopts) {
      return runtime.wait(runId, wopts);
    },
    cancel(runId) {
      return runtime.cancel(runId);
    },
    sendSignal(runId, name, data) {
      return runtime.sendSignal(runId, name, data);
    },
    wake(runId, data) {
      return runtime.sendSignal(runId, "wake", data);
    },
  };
}

/**
 * S2e engine override for commands that forward it (engage/dispatch).
 * Unknown --engine / env value → undefined marker "invalid" so runCli can
 * print help and exit 2 (fail-closed), matching pre-existing CLI behavior.
 */
function resolveEngineOverride(
  parsed: CliArgs,
): { readonly engine?: EngineKind; readonly invalid: boolean } {
  if (parsed.engine !== undefined) {
    try {
      return { engine: asEngineKind(parsed.engine), invalid: false };
    } catch {
      return { invalid: true };
    }
  }
  const envEngine = process.env.MEDIATION_CLI_ENGINE;
  if (envEngine !== undefined && envEngine !== "") {
    try {
      return { engine: asEngineKind(envEngine), invalid: false };
    } catch {
      return { invalid: true };
    }
  }
  return { invalid: false };
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help") {
    console.error(printHelp());
    return 0;
  }
  if (parsed.command === "unknown") {
    console.error(printHelp());
    return 2;
  }

  // Required-argument gates per subcommand (fail-closed, exit 2).
  const needsAgentTask =
    parsed.command === "engage" || parsed.command === "dispatch";
  if (needsAgentTask && (!parsed.agentDir || !parsed.task)) {
    console.error(printHelp());
    return 2;
  }
  const needsRunId =
    parsed.command === "status" ||
    parsed.command === "wait" ||
    parsed.command === "cancel" ||
    parsed.command === "wake";
  if (needsRunId && !parsed.runId) {
    console.error(printHelp());
    return 2;
  }
  if (parsed.command === "wake" && !parsed.text) {
    console.error(printHelp());
    return 2;
  }

  // S2e §3 — CLI engine precedence:
  //   --engine flag > MEDIATION_CLI_ENGINE env > MEDIATION_CLI_PI=1 ("pi") >
  //   definition/config > CLI smoke default "mock" (composition default).
  const engineOverride = needsAgentTask ? resolveEngineOverride(parsed) : undefined;
  if (engineOverride?.invalid) {
    console.error(printHelp());
    return 2;
  }

  const legacyUsePi = process.env.MEDIATION_CLI_PI === "1";
  // Phase-2 daemon IPC: endpoint resolution --ipc flag > MEDIATION_IPC env >
  // MEDIATION_DB_PATH (sqlite runtime client) > local composition.
  const ipcEndpoint = parsed.ipc ?? (process.env.MEDIATION_IPC || undefined);
  const spawnDaemon =
    parsed.spawn === true || process.env.MEDIATION_IPC_SPAWN === "1";
  const dbPath = process.env.MEDIATION_DB_PATH;
  const hasDbPath = dbPath !== undefined && dbPath !== "";

  // Auto-spawn lifecycle: only for runtime verbs over IPC with --spawn.
  if (
    options.surface === undefined &&
    parsed.command !== "engage" &&
    ipcEndpoint !== undefined &&
    spawnDaemon
  ) {
    await ensureDaemon({ endpoint: ipcEndpoint });
  }

  // engage is always local. dispatch routes through the daemon (IPC or
  // sqlite runtime client) when one is configured; other runtime verbs use
  // composeRuntimeSurface (which falls back to the local composition when
  // neither transport is configured).
  const useRuntimeSurface =
    parsed.command !== "engage" &&
    (parsed.command !== "dispatch" || ipcEndpoint !== undefined || hasDbPath);

  const composed =
    options.surface !== undefined
      ? { surface: options.surface }
      : useRuntimeSurface
        ? composeRuntimeSurface({
            projectRoot: path.resolve(parsed.projectRoot ?? process.cwd()),
            // CLI smoke default stays mock (no-keys local runs). The legacy
            // Pi env switches the composition default to pi; --engine /
            // MEDIATION_CLI_ENGINE travel as the per-call override (they
            // beat everything downstream).
            defaultEngine: legacyUsePi ? "pi" : "mock",
            ipcEndpoint,
            spawnDaemon,
          })
        : {
            surface: composeDefaultSurface({
              projectRoot: path.resolve(parsed.projectRoot ?? process.cwd()),
              defaultEngine: legacyUsePi ? "pi" : "mock",
            }),
          };
  const surface = composed.surface;
  try {
    return await dispatchCommand(parsed, surface, engineOverride);
  } finally {
    await composed.close?.();
  }
}

async function dispatchCommand(
  parsed: CliArgs,
  surface: SurfacePort,
  engineOverride: { readonly engine?: EngineKind; readonly invalid: boolean } | undefined,
): Promise<number> {
  switch (parsed.command) {
    case "engage": {
      const agentDir = path.resolve(parsed.agentDir!);
      const agentName = parsed.name ?? path.basename(agentDir);

      const result = await surface.engageLocal({
        agent: { name: agentName, rootDir: agentDir },
        task: parsed.task!,
        resume: parsed.resume ? asSessionRef(parsed.resume) : undefined,
        cwd: agentDir,
        channel: "cli",
        engine: engineOverride?.engine,
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

    case "dispatch": {
      if (typeof surface.dispatch !== "function") {
        console.error("mediation CLI: SurfacePort has no dispatch (no RuntimePort wired)");
        return 1;
      }
      const agentDir = path.resolve(parsed.agentDir!);
      const agentName = parsed.name ?? path.basename(agentDir);
      const handle = await surface.dispatch({
        agent: { name: agentName, rootDir: agentDir },
        task: parsed.task!,
        resume: parsed.resume ? asSessionRef(parsed.resume) : undefined,
        cwd: agentDir,
        channel: "cli",
        clientRequestId: parsed.clientRequestId,
        engine: engineOverride?.engine,
      });

      if (parsed.wait === true && typeof surface.wait === "function") {
        const status = await surface.wait(handle.runId, {
          timeoutMs: parsed.timeoutMs,
        });
        if (parsed.json) {
          console.log(JSON.stringify({ runId: handle.runId, status }, null, 2));
        } else {
          console.log(`runId=${handle.runId}`);
          console.log(`state=${status.state}`);
        }
        return status.state === "failed" ? 1 : 0;
      }

      if (parsed.json) {
        console.log(JSON.stringify({ runId: handle.runId }, null, 2));
      } else {
        console.log(`runId=${handle.runId}`);
      }
      return 0;
    }

    case "status": {
      if (typeof surface.getStatus !== "function") {
        console.error("mediation CLI: SurfacePort has no getStatus");
        return 1;
      }
      const status = await surface.getStatus(parsed.runId as never);
      if (parsed.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`state=${status.state}`);
      }
      return status.state === "failed" ? 1 : 0;
    }

    case "wait": {
      if (typeof surface.wait !== "function") {
        console.error("mediation CLI: SurfacePort has no wait");
        return 1;
      }
      const status = await surface.wait(parsed.runId as never, {
        timeoutMs: parsed.timeoutMs,
      });
      if (parsed.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`state=${status.state}`);
      }
      return status.state === "failed" ? 1 : 0;
    }

    case "cancel": {
      if (typeof surface.cancel !== "function") {
        console.error("mediation CLI: SurfacePort has no cancel");
        return 1;
      }
      await surface.cancel(parsed.runId as never);
      if (parsed.json) {
        console.log(JSON.stringify({ runId: parsed.runId, canceled: true }, null, 2));
      } else {
        console.log(`runId=${parsed.runId}`);
        console.log("canceled=true");
      }
      return 0;
    }

    case "wake": {
      if (typeof surface.wake !== "function") {
        console.error("mediation CLI: SurfacePort has no wake");
        return 1;
      }
      await surface.wake(parsed.runId as never, {
        payloadText: parsed.text!,
        mode: parsed.mode === "prompt" ? "prompt" : "continue",
        parkIntent: parsed.parkIntent,
        parkReason: parsed.parkReason,
      });
      if (parsed.json) {
        console.log(JSON.stringify({ runId: parsed.runId, wake: "sent" }, null, 2));
      } else {
        console.log(`runId=${parsed.runId}`);
        console.log("wake=sent");
      }
      return 0;
    }

    default:
      console.error(printHelp());
      return 2;
  }
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
