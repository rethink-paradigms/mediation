/**
 * Composition root: wire PiEngineAdapter + CapabilityResolver + DefaultPresenceFactory.
 *
 * Not app layer (app stays domain + ports only). Not a second product door —
 * composition / tests import this module; public `src/index.ts` does not re-export Pi.
 *
 * ```ts
 * const { factory } = createPiPresenceFactory({
 *   inMemorySession: true,
 *   projectRoot,
 * });
 * const presence = await factory.materialize(definition);
 * const outcome = await presence.engage({ text: "hello" });
 * // outcome.kind === "settled"
 * ```
 */

import {
  DefaultPresenceFactory,
  type PackSnapshotFn,
} from "../app/factory.ts";
import type { CapabilityResolver } from "../ports/capability-resolver.ts";
import type { CapabilityStore } from "../ports/capability-store.ts";
import {
  createFsCapabilityStore,
  type FsCapabilityStoreOptions,
} from "./capability/fs-store.ts";
import { MemoryCapabilityStore } from "./capability/memory-store.ts";
import { createCapabilityResolver } from "./capability/resolve.ts";
import { toPackSnapshot } from "./packs/pack-snapshot.ts";
import { PiEngineAdapter } from "./pi/engine-adapter.ts";
import type { PiEngineAdapterOptions } from "./pi/types.ts";

export type CreatePiPresenceFactoryOptions = PiEngineAdapterOptions & {
  /** Snapshot fn (default: adapters/packs.toPackSnapshot). */
  readonly toPackSnapshot?: PackSnapshotFn;
  /**
   * Project / pack root for default FsCapabilityStore when no resolver/store set.
   */
  readonly projectRoot?: string;
  /**
   * Explicit CapabilityResolver (preferred when set).
   * CUT: required resolve path — no PackResolver dual path.
   */
  readonly capabilityResolver?: CapabilityResolver;
  /** When resolver omitted, wrap this store via createCapabilityResolver. */
  readonly capabilityStore?: CapabilityStore;
  /**
   * Options for default FsCapabilityStore (homeDir override for tests).
   * Used when neither capabilityResolver nor capabilityStore is set and
   * projectRoot is known.
   */
  readonly fsStoreOptions?: Omit<FsCapabilityStoreOptions, "projectRoot">;
};

/** Result of createPiPresenceFactory — factory is the product; engine for inspection. */
export type PiPresenceComposition = {
  readonly factory: DefaultPresenceFactory;
  readonly engine: PiEngineAdapter;
};

/**
 * Build CapabilityResolver for Pi / local composition (D5 / CUT).
 * Prefer explicit resolver → store → Fs(projectRoot) → empty Memory.
 */
export function resolveCapabilityResolver(
  opts: Pick<
    CreatePiPresenceFactoryOptions,
    | "capabilityResolver"
    | "capabilityStore"
    | "projectRoot"
    | "fsStoreOptions"
  >,
): CapabilityResolver {
  if (opts.capabilityResolver !== undefined) {
    return opts.capabilityResolver;
  }
  if (opts.capabilityStore !== undefined) {
    return createCapabilityResolver(opts.capabilityStore);
  }
  if (opts.projectRoot !== undefined) {
    return createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: opts.projectRoot,
        ...opts.fsStoreOptions,
      }),
    );
  }
  // No FS root: empty memory store — materialize with extensions fail-closed.
  return createCapabilityResolver(new MemoryCapabilityStore());
}

/**
 * Build DefaultPresenceFactory over real PiEngineAdapter (+ capability resolve).
 * Inject sessionFactory for unit path without live Pi open.
 */
export function createPiPresenceFactory(
  opts: CreatePiPresenceFactoryOptions = {},
): PiPresenceComposition {
  const {
    toPackSnapshot: snapFn,
    capabilityResolver: _cr,
    capabilityStore: _cs,
    fsStoreOptions: _fs,
    projectRoot: _pr,
    ...engineOpts
  } = opts;

  const engine = new PiEngineAdapter(engineOpts);
  const factory = new DefaultPresenceFactory({
    engine,
    toPackSnapshot: snapFn ?? toPackSnapshot,
    capabilityResolver: resolveCapabilityResolver(opts),
  });

  return { factory, engine };
}
