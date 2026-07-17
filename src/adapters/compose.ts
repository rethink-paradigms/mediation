/**
 * Composition roots for Mediation façade (S7).
 * Adapters layer — may import mock/pi/definition helpers; app stays pure.
 *
 * ABS-C2: createHostedMediation wires createSqliteRuntimeHost so
 * Mediation.dispatch / wait use a real RuntimePort.
 */

import { DefaultPresenceFactory } from "../app/factory.ts";
import { Mediation, type MediationDeps } from "../app/mediation.ts";
import type { JoinStore } from "../ports/join.ts";
import type { RuntimePort } from "../ports/runtime.ts";
import {
  createYamlDefinitionLoader,
  type YamlDefinitionLoaderOptions,
} from "./definition/yaml-definition-loader.ts";
import { MemoryJoinStore } from "./join/memory-store.ts";
import { MockEnginePort } from "./mock/engine-adapter.ts";
import { toPackSnapshot } from "./packs/pack-snapshot.ts";
import {
  createPackResolver,
  type PackResolverImplOptions,
} from "./packs/resolve-packs.ts";
import {
  createPiPresenceFactory,
  type CreatePiPresenceFactoryOptions,
} from "./wiring.ts";
import {
  createSqliteRuntimeHost,
  type CreateSqliteRuntimeHostOptions,
  type RuntimeHostWorker,
  type SqliteRuntimeHost,
} from "./openworkflow/host.ts";
import type { RegisterEngagementWorkflowDeps } from "./openworkflow/register-engagement.ts";

export type CreateLocalMediationOptions = {
  readonly loaderOptions?: YamlDefinitionLoaderOptions;
  readonly packResolverOptions?: PackResolverImplOptions;
  readonly projectRoot?: string;
  readonly join?: JoinStore;
  readonly runtime?: RuntimePort;
  /** Prefer mock mind (default true for CLI smoke without keys). */
  readonly mockEngine?: boolean;
  /** When mockEngine is false, Pi factory options. */
  readonly pi?: CreatePiPresenceFactoryOptions;
};

export type LocalMediationComposition = {
  readonly mediation: Mediation;
  readonly join: JoinStore;
};

type MindWiring = {
  readonly loader: MediationDeps["loader"];
  readonly factory: MediationDeps["factory"];
  readonly join: JoinStore;
};

function wireMind(opts: CreateLocalMediationOptions): MindWiring {
  const loader = createYamlDefinitionLoader(opts.loaderOptions);
  const join = opts.join ?? new MemoryJoinStore();

  let factory: MediationDeps["factory"];
  if (opts.mockEngine === false) {
    const composed = createPiPresenceFactory({
      ...opts.pi,
      packResolverOptions:
        opts.pi?.packResolverOptions ?? opts.packResolverOptions,
      projectRoot: opts.pi?.projectRoot ?? opts.projectRoot,
    });
    factory = composed.factory;
  } else {
    factory = new DefaultPresenceFactory({
      engine: new MockEnginePort(),
      packResolver: createPackResolver(opts.packResolverOptions),
      toPackSnapshot,
      projectRoot: opts.projectRoot,
    });
  }

  return { loader, factory, join };
}

/**
 * Wire Mediation for local engage (mock mind by default).
 * Dispatch requires caller-supplied `runtime`.
 */
export function createLocalMediation(
  opts: CreateLocalMediationOptions = {},
): LocalMediationComposition {
  const { loader, factory, join } = wireMind(opts);

  const mediation = new Mediation({
    loader,
    factory,
    join,
    runtime: opts.runtime,
  });

  return { mediation, join };
}

/**
 * Host options for createHostedMediation (sqlite OW).
 * Mind/loader options mirror createLocalMediation; runtime comes from host.
 */
export type CreateHostedMediationOptions = CreateLocalMediationOptions & {
  /** OW BackendSqlite path — filesystem file or `:memory:`. */
  readonly dbPath: string;
  /** When true, also register plan workflow on the host. */
  readonly registerPlan?: boolean;
  /** Worker concurrency (default 1). */
  readonly concurrency?: number;
  /** RuntimePort.wait poll interval (default host 50ms; tests often use 15). */
  readonly pollIntervalMs?: number;
  /**
   * Override leaf definition resolve (default: yaml loader via agentName/agentRoot).
   * Tests often inject inert defs without filesystem yaml.
   */
  readonly resolveDefinition?: RegisterEngagementWorkflowDeps["resolveDefinition"];
  /** Override engagement WorkflowSpec (must match registered name). */
  readonly engagementSpec?: CreateSqliteRuntimeHostOptions["engagementSpec"];
};

export type HostedMediationComposition = {
  readonly mediation: Mediation;
  readonly join: JoinStore;
  readonly host: SqliteRuntimeHost;
  readonly runtime: RuntimePort;
  readonly worker: RuntimeHostWorker;
  /** Stop worker (if started) + OW sqlite backend. */
  stop(): Promise<void>;
};

/**
 * Compose Mediation with createSqliteRuntimeHost so dispatch/wait work.
 * Shared factory + join across façade and worker leaf. Mock mind by default.
 *
 * ```ts
 * const { mediation, worker, stop } = createHostedMediation({
 *   dbPath: ":memory:",
 *   projectRoot,
 * });
 * await worker.start();
 * const handle = await mediation.dispatch({ agent, task });
 * await mediation.wait(handle.runId);
 * await stop();
 * ```
 */
export function createHostedMediation(
  opts: CreateHostedMediationOptions,
): HostedMediationComposition {
  const { loader, factory, join } = wireMind(opts);

  const resolveDefinition: RegisterEngagementWorkflowDeps["resolveDefinition"] =
    opts.resolveDefinition ??
    ((inp) =>
      loader.load({
        name: inp.agentName,
        rootDir: inp.agentRoot,
      }));

  const host = createSqliteRuntimeHost({
    dbPath: opts.dbPath,
    factory,
    join,
    resolveDefinition,
    registerPlan: opts.registerPlan,
    concurrency: opts.concurrency,
    pollIntervalMs: opts.pollIntervalMs,
    engagementSpec: opts.engagementSpec,
  });

  const mediation = new Mediation({
    loader,
    factory,
    join: host.join,
    runtime: host.runtime,
  });

  return {
    mediation,
    join: host.join,
    host,
    runtime: host.runtime,
    worker: host.worker,
    stop: () => host.stop(),
  };
}
