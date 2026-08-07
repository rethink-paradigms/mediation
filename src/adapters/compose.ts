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
import type {
  CapabilityPublisher,
  CapabilityStore,
} from "../ports/capability-store.ts";
import type { JoinStore } from "../ports/join.ts";
import type { RuntimePort } from "../ports/runtime.ts";
import type { FsCapabilityStoreOptions } from "./capability/fs-store.ts";
import {
  CompositeCapabilityStore,
  createCompositeCapabilityStore,
} from "./capability/composite-store.ts";
import { createFsCapabilityStore } from "./capability/fs-store.ts";
import { MemoryCapabilityStore } from "./capability/memory-store.ts";
import { createCapabilityResolver } from "./capability/resolve.ts";
import { createRegistryCapabilityStore, RegistryCapabilityStore } from "./capability/registry-store.ts";
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
  /**
   * Ordered CapabilityStore chain for a CompositeCapabilityStore (D5 L2/L4).
   * First hit wins. Wins over `capabilityStore` when both are set.
   * Publish routes to the first chain store that implements CapabilityPublisher
   * (the registry at position 0 in the default chain).
   */
  readonly capabilityStores?: readonly CapabilityStore[];
  /**
   * In-process registry for the DEFAULT composite chain (registry → fs).
   * When omitted, compose creates a fresh RegistryCapabilityStore. Ignored
   * when capabilityResolver / capabilityStore / capabilityStores are set.
   */
  readonly registryStore?: RegistryCapabilityStore;
};

/**
 * Resolve CapabilityResolver for DefaultPresenceFactory / Pi factory.
 * Prefer explicit resolver; else wrap store; else Fs(projectRoot); else empty Memory.
 * Re-exported from wiring for a single default policy.
 */
export { resolveCapabilityResolver };

/**
 * Composite-aware default resolver (D5 L2/L4). Resolution policy:
 *   1. explicit CapabilityResolver wins (no chain introspection);
 *   2. explicit single CapabilityStore → wrapped;
 *   3. explicit ordered chain (capabilityStores) → composite, first hit wins,
 *      publish routes to the first publisher-capable store;
 *   4. projectRoot known → composite [registry, fs] — published capabilities
 *      win, legacy FS search remains the fallback (backward compat);
 *   5. otherwise an empty MemoryCapabilityStore (materialize with extensions
 *      fails closed).
 * Returns the resolver plus the store chain / default registry for tests and
 * diagnostics.
 */
export function resolveCapabilityResolverWithStores(opts: {
  readonly capabilityResolver?: CapabilityResolver;
  readonly capabilityStore?: CapabilityStore;
  readonly capabilityStores?: readonly CapabilityStore[];
  readonly projectRoot?: string;
  readonly fsStoreOptions?: Omit<FsCapabilityStoreOptions, "projectRoot">;
  readonly registryStore?: RegistryCapabilityStore;
}): {
  readonly resolver: CapabilityResolver;
  readonly stores: readonly CapabilityStore[];
  readonly registry: RegistryCapabilityStore | undefined;
} {
  if (opts.capabilityResolver !== undefined) {
    return { resolver: opts.capabilityResolver, stores: [], registry: undefined };
  }
  if (opts.capabilityStore !== undefined) {
    return {
      resolver: createCapabilityResolver(opts.capabilityStore),
      stores: [opts.capabilityStore],
      registry: undefined,
    };
  }
  if (opts.capabilityStores !== undefined && opts.capabilityStores.length > 0) {
    const composite = createCompositeCapabilityStore({
      stores: opts.capabilityStores,
      publisher: firstPublisherOf(opts.capabilityStores),
    });
    return {
      resolver: createCapabilityResolver(composite),
      stores: [...opts.capabilityStores],
      registry: undefined,
    };
  }
  if (opts.projectRoot !== undefined) {
    const registry = opts.registryStore ?? createRegistryCapabilityStore();
    const fs = createFsCapabilityStore({
      projectRoot: opts.projectRoot,
      ...opts.fsStoreOptions,
    });
    const composite = new CompositeCapabilityStore({
      stores: [registry, fs],
      publisher: registry,
    });
    return {
      resolver: createCapabilityResolver(composite),
      stores: [registry, fs],
      registry,
    };
  }
  const memory = new MemoryCapabilityStore();
  return { resolver: createCapabilityResolver(memory), stores: [memory], registry: undefined };
}

/** First chain store that implements CapabilityPublisher (publish target). */
function firstPublisherOf(
  stores: readonly CapabilityStore[],
): CapabilityPublisher | undefined {
  for (const store of stores) {
    const maybePublisher = store as unknown as CapabilityPublisher;
    if (typeof maybePublisher.publish === "function") {
      return maybePublisher;
    }
  }
  return undefined;
}

export type LocalMediationComposition = {
  readonly mediation: Mediation;
  readonly join: JoinStore;
  /**
   * Ordered capability store chain behind the resolver (empty when an explicit
   * CapabilityResolver was injected). Default: [registry, fs].
   */
  readonly capabilityStores: readonly CapabilityStore[];
  /**
   * The in-process registry created by the default composite chain (undefined
   * when resolver/store/chain were injected explicitly). Builder agents
   * publish here; the composite resolves through it before falling to fs.
   */
  readonly registry: RegistryCapabilityStore | undefined;
};

type MindWiring = {
  readonly loader: MediationDeps["loader"];
  readonly factory: MediationDeps["factory"];
  readonly join: JoinStore;
  readonly capabilityStores: readonly CapabilityStore[];
  readonly registry: RegistryCapabilityStore | undefined;
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
  const {
    resolver: capabilityResolver,
    stores: capabilityStores,
    registry: capabilityRegistry,
  } = resolveCapabilityResolverWithStores({
      capabilityResolver: opts.capabilityResolver,
      capabilityStore: opts.capabilityStore,
      capabilityStores: opts.capabilityStores,
      projectRoot: opts.projectRoot,
      fsStoreOptions: opts.fsStoreOptions,
      registryStore: opts.registryStore,
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

  return { loader, factory, join, capabilityStores, registry: capabilityRegistry };
}

/**
 * Wire Mediation for local engage (mock mind by default).
 * Dispatch requires caller-supplied `runtime`.
 * Default resolve path: FsCapabilityStore(projectRoot) + CapabilityResolver.
 */
export function createLocalMediation(
  opts: CreateLocalMediationOptions = {},
): LocalMediationComposition {
  const { loader, factory, join, capabilityStores, registry } = wireMind(opts);

  const mediation = new Mediation({
    loader,
    factory,
    join,
    runtime: opts.runtime,
  });

  return { mediation, join, capabilityStores, registry };
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
  /** Ordered capability store chain behind the resolver (see LocalMediationComposition). */
  readonly capabilityStores: readonly CapabilityStore[];
  /** In-process registry of the default composite chain (see LocalMediationComposition). */
  readonly registry: RegistryCapabilityStore | undefined;
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
  const { loader, factory, capabilityStores, registry } = wireMind(opts);
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
    capabilityStores,
    registry,
    stop: async () => {
      await host.stop();
      ownedSqliteJoin?.close();
    },
  };
}

