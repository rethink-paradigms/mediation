/**
 * Composition roots for Mediation façade (S7).
 * Adapters layer — may import mock/pi/definition helpers; app stays pure.
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

/**
 * Wire Mediation for local engage (mock mind by default).
 * Dispatch requires caller-supplied `runtime`.
 */
export function createLocalMediation(
  opts: CreateLocalMediationOptions = {},
): LocalMediationComposition {
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

  const mediation = new Mediation({
    loader,
    factory,
    join,
    runtime: opts.runtime,
  });

  return { mediation, join };
}
