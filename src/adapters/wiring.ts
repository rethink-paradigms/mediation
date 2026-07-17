/**
 * Composition root: wire PiEngineAdapter + PackResolver + DefaultPresenceFactory.
 *
 * Not app layer (app stays domain + ports only). Not a second product door —
 * composition / tests import this module; public `src/index.ts` does not re-export Pi.
 *
 * ```ts
 * const { factory } = createPiPresenceFactory({ inMemorySession: true });
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
import type { PackResolver } from "../ports/pack-resolver.ts";
import { toPackSnapshot } from "./packs/pack-snapshot.ts";
import {
  createPackResolver,
  type PackResolverImplOptions,
} from "./packs/resolve-packs.ts";
import { PiEngineAdapter } from "./pi/engine-adapter.ts";
import type { PiEngineAdapterOptions } from "./pi/types.ts";

export type CreatePiPresenceFactoryOptions = PiEngineAdapterOptions & {
  /** Inject a PackResolver (tests). Default: createPackResolver(packResolverOptions). */
  readonly packResolver?: PackResolver;
  /** Used when packResolver is omitted. */
  readonly packResolverOptions?: PackResolverImplOptions;
  /** Snapshot fn (default: adapters/packs.toPackSnapshot). */
  readonly toPackSnapshot?: PackSnapshotFn;
  /**
   * Optional override for project root when resolving packs.
   * Default: definition.rootDir or MaterializeOptions.cwd.
   */
  readonly projectRoot?: string;
  /**
   * ABS-A7: when set, materialize uses CapabilityResolver (fail-closed)
   * instead of PackResolver for pack plan construction.
   */
  readonly capabilityResolver?: CapabilityResolver;
};

/** Result of createPiPresenceFactory — factory is the product; engine for inspection. */
export type PiPresenceComposition = {
  readonly factory: DefaultPresenceFactory;
  readonly engine: PiEngineAdapter;
};

/**
 * Build DefaultPresenceFactory over real PiEngineAdapter (+ packs).
 * Inject sessionFactory for unit path without live Pi open.
 */
export function createPiPresenceFactory(
  opts: CreatePiPresenceFactoryOptions = {},
): PiPresenceComposition {
  const {
    packResolver: injectedResolver,
    packResolverOptions,
    toPackSnapshot: snapFn,
    projectRoot,
    capabilityResolver,
    ...engineOpts
  } = opts;

  const engine = new PiEngineAdapter(engineOpts);
  const packResolver =
    injectedResolver ?? createPackResolver(packResolverOptions);
  const factory = new DefaultPresenceFactory({
    engine,
    packResolver,
    toPackSnapshot: snapFn ?? toPackSnapshot,
    projectRoot,
    capabilityResolver,
  });

  return { factory, engine };
}
