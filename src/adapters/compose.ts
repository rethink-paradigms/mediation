/**
 * Composition roots for Mediation façade (S7).
 * Adapters layer — may import mock/pi/definition helpers; app stays pure.
 *
 * ABS-C2: createHostedMediation wires createSqliteRuntimeHost so
 * Mediation.dispatch / wait use a real RuntimePort.
 *
 * CUT: always wires CapabilityResolver (FsCapabilityStore default when
 * projectRoot known). No PackResolver dual path into the factory.
 *
 * PRODUCT-1: file-backed hosted dbPath defaults durable SqliteJoinStore
 * (Memory only for :memory: or explicit inject).
 */

import path from "node:path";

import { DefaultPresenceFactory } from "../app/factory.ts";
import type { EngineKind } from "../domain/engine.ts";
import { createEngineRegistry } from "./engine-registry.ts";
import type { EngineRegistry } from "../ports/engine.ts";
import { Mediation, type MediationDeps } from "../app/mediation.ts";
import type { CapabilityResolver } from "../ports/capability-resolver.ts";
import type { CapabilityStore } from "../ports/capability-store.ts";
import type { JoinStore } from "../ports/join.ts";
import type { RuntimePort } from "../ports/runtime.ts";
import type { FsCapabilityStoreOptions } from "./capability/fs-store.ts";
import {
  createYamlDefinitionLoader,
  type YamlDefinitionLoaderOptions,
} from "./definition/yaml-definition-loader.ts";
import { MemoryJoinStore } from "./join/memory-store.ts";
import { SqliteJoinStore } from "./join/sqlite-store.ts";
import { toPackSnapshot } from "./packs/pack-snapshot.ts";
import {
  createPiPresenceFactory,
  resolveCapabilityResolver,
  type CreatePiPresenceFactoryOptions,
} from "./wiring.ts";
import {
  createSqliteRuntimeHost,
  type CreateSqliteRuntimeHostOptions,
  type RuntimeHostWorker,
  type SqliteRuntimeHost,
} from "./openworkflow/host.ts";
import type { SpawnLeafConfig } from "./openworkflow/spawn-leaf.ts";
import type { RegisterEngagementWorkflowDeps } from "./openworkflow/register-engagement.ts";


/** Default durable join file next to OW BackendSqlite path (PRODUCT-1). */
export function defaultHostedJoinPath(dbPath: string): string {
  return path.join(path.dirname(path.resolve(dbPath)), "mediation-join.sqlite");
}

/**
 * Product join policy for createHostedMediation.
 * Explicit `join` wins; else file db → SqliteJoinStore; else Memory.
 */
export function resolveHostedJoin(opts: {
  readonly join?: JoinStore;
  readonly dbPath: string;
  readonly joinPath?: string;
}): { readonly join: JoinStore; readonly ownedSqliteJoin: SqliteJoinStore | null } {
  if (opts.join !== undefined) {
    return { join: opts.join, ownedSqliteJoin: null };
  }
  if (opts.dbPath !== ":memory:") {
    const joinFile = opts.joinPath ?? defaultHostedJoinPath(opts.dbPath);
    const owned = new SqliteJoinStore({ path: joinFile });
    return { join: owned, ownedSqliteJoin: owned };
  }
  return { join: new MemoryJoinStore(), ownedSqliteJoin: null };
}

export type CreateLocalMediationOptions = {
  readonly loaderOptions?: YamlDefinitionLoaderOptions;
  readonly projectRoot?: string;
  readonly join?: JoinStore;
  readonly runtime?: RuntimePort;
  /** Prefer mock mind (default true for CLI smoke without keys). */
  readonly mockEngine?: boolean;
  /** When mockEngine is false, Pi factory options. */
  readonly pi?: CreatePiPresenceFactoryOptions;
  /**
   * Composition fallback engine for resolveEngineKind (S2e).
   * Explicit `defaultEngine` wins over legacy `mockEngine` mapping:
   * mockEngine:false → "pi"; mockEngine:true|undefined → "mock".
   */
  readonly defaultEngine?: EngineKind;
  /**
   * Explicit EngineRegistry (test injection). When omitted, compose builds
   * createEngineRegistry() (pi/mock eager-or-lazy, prime lazy dynamic import).
   */
  readonly engineRegistry?: EngineRegistry;
  /**
   * Explicit CapabilityResolver (preferred when set).
   * CUT: sole materialize resolve path.
   */
  readonly capabilityResolver?: CapabilityResolver;
  /** When resolver omitted, wrap via createCapabilityResolver. */
  readonly capabilityStore?: CapabilityStore;
  /**
   * Options for default FsCapabilityStore (homeDir override for tests).
   * Applied when neither capabilityResolver nor capabilityStore is set and
   * projectRoot is known.
   */
  readonly fsStoreOptions?: Omit<FsCapabilityStoreOptions, "projectRoot">;
};

/**
 * Resolve CapabilityResolver for DefaultPresenceFactory / Pi factory.
 * Prefer explicit resolver; else wrap store; else Fs(projectRoot); else empty Memory.
 * Re-exported from wiring for a single default policy.
 */
export { resolveCapabilityResolver };

export type LocalMediationComposition = {
  readonly mediation: Mediation;
  readonly join: JoinStore;
};

type MindWiring = {
  readonly loader: MediationDeps["loader"];
  readonly factory: MediationDeps["factory"];
  readonly join: JoinStore;
};

/** Composition default engine: explicit wins; else legacy mockEngine mapping. */
export function resolveCompositionDefaultEngine(opts: {
  readonly defaultEngine?: EngineKind;
  readonly mockEngine?: boolean;
}): EngineKind {
  if (opts.defaultEngine !== undefined) return opts.defaultEngine;
  return opts.mockEngine === false ? "pi" : "mock";
}

function wireMind(opts: CreateLocalMediationOptions): MindWiring {
  const loader = createYamlDefinitionLoader(opts.loaderOptions);
  const join = opts.join ?? new MemoryJoinStore();
  const capabilityResolver = resolveCapabilityResolver({
    capabilityResolver: opts.capabilityResolver,
    capabilityStore: opts.capabilityStore,
    projectRoot: opts.projectRoot,
    fsStoreOptions: opts.fsStoreOptions,
  });

  // Legacy `pi` composition options → custom pi factory in the registry
  // (keeps PiEngineAdapter sessionFactory/auth/inMemory/log wiring intact).
  const piFactory =
    opts.pi !== undefined
      ? () =>
          createPiPresenceFactory({
            ...opts.pi!,
            projectRoot: opts.pi!.projectRoot ?? opts.projectRoot,
            capabilityResolver:
              opts.pi!.capabilityResolver ?? capabilityResolver,
            capabilityStore:
              opts.pi!.capabilityStore ?? opts.capabilityStore,
            fsStoreOptions: opts.pi!.fsStoreOptions ?? opts.fsStoreOptions,
          }).engine
      : undefined;

  const registry =
    opts.engineRegistry ??
    createEngineRegistry(piFactory !== undefined ? { pi: piFactory } : {});

  const factory = new DefaultPresenceFactory({
    registry,
    defaultEngine: resolveCompositionDefaultEngine(opts),
    toPackSnapshot,
    capabilityResolver,
  });

  return { loader, factory, join };
}

/**
 * Wire Mediation for local engage (mock mind by default).
 * Dispatch requires caller-supplied `runtime`.
 * Default resolve path: FsCapabilityStore(projectRoot) + CapabilityResolver.
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
 *
 * PRODUCT-1 join policy when `join` omitted:
 * - file `dbPath` → SqliteJoinStore at `joinPath` or sibling mediation-join.sqlite
 * - `:memory:` → MemoryJoinStore
 */
export type CreateHostedMediationOptions = CreateLocalMediationOptions & {
  /** OW BackendSqlite path — filesystem file or `:memory:`. */
  readonly dbPath: string;
  /**
   * Durable join sqlite path when `join` is omitted and `dbPath` is a file.
   * Default: `<dirname(dbPath)>/mediation-join.sqlite`.
   */
  readonly joinPath?: string;
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
  /**
   * When set, engagement leaves run as isolated child processes.
   * Omit for in-process usage (:memory: tests). Set for the production daemon.
   * If omitted but dbPath is a file, joinPath is derived automatically when
   * building SpawnLeafConfig — supply explicitly for full control.
   */
  readonly spawnConfig?: SpawnLeafConfig;
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
 * PRODUCT-1: file-backed `dbPath` defaults durable SqliteJoinStore; owned
 * join is closed on `stop()`. Explicit `join` is never closed by compose.
 *
 * ```ts
 * const { mediation, worker, stop } = createHostedMediation({
 *   dbPath: "/tmp/mediation-ow.sqlite",
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
  // Hosted join is product-policy (PRODUCT-1); wireMind join is unused here.
  const { loader, factory } = wireMind(opts);
  const { join, ownedSqliteJoin } = resolveHostedJoin({
    join: opts.join,
    dbPath: opts.dbPath,
    joinPath: opts.joinPath,
  });

  const resolveDefinition: RegisterEngagementWorkflowDeps["resolveDefinition"] =
    opts.resolveDefinition ??
    ((inp) =>
      loader.load({
        name: inp.agentName,
        rootDir: inp.agentRoot,
      }));

  // S2e: the hosted composition default flows into both the in-process leaf
  // (CreateSqliteRuntimeHostOptions.defaultEngine) and, when spawn mode is
  // used, the child runner (--default-engine) so records match the factory.
  const defaultEngine = resolveCompositionDefaultEngine(opts);
  const spawnConfig: SpawnLeafConfig | undefined =
    opts.spawnConfig === undefined
      ? undefined
      : {
          ...opts.spawnConfig,
          defaultEngine:
            opts.spawnConfig.defaultEngine ??
            (opts.spawnConfig.usePi === true
              ? "pi"
              : opts.spawnConfig.usePi === false
                ? "mock"
                : defaultEngine),
        };

  const host = createSqliteRuntimeHost({
    dbPath: opts.dbPath,
    factory,
    join,
    resolveDefinition,
    registerPlan: opts.registerPlan,
    concurrency: opts.concurrency,
    pollIntervalMs: opts.pollIntervalMs,
    engagementSpec: opts.engagementSpec,
    spawnConfig,
    defaultEngine,
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
    stop: async () => {
      await host.stop();
      ownedSqliteJoin?.close();
    },
  };
}

