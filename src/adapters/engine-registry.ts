/**
 * createEngineRegistry — EngineRegistry adapter (S2e).
 *
 * Lazy + cached: each kind's factory runs on first get(kind); the resolved
 * EnginePort (or the in-flight promise) is memoized. Engine constructors are
 * cheap (session open is deferred to openSession), so laziness is a safe
 * default and keeps the registry side-effect free until first use.
 *
 * Prime seam: the "prime" adapter lives in src/adapters/prime/ (parallel
 * slice). There is NO static import of adapters/prime anywhere in this
 * package — the module is loaded with a dynamic import inside get(), and a
 * clear ENGINE_UNKNOWN error is raised when the module is absent. Wiring
 * "prime" into the registry requires no code change here once the module
 * exists: it is picked up automatically.
 */

import { MediationError } from "../domain/errors.ts";
import {
  ENGINE_KINDS,
  isEngineKind,
  type EngineKind,
} from "../domain/engine.ts";
import type { EnginePort, EngineRegistry } from "../ports/engine.ts";
import { MockEnginePort } from "./mock/engine-adapter.ts";
import { PiEngineAdapter } from "./pi/engine-adapter.ts";

/** Factory options for createEngineRegistry — all lazy, all overridable. */
export type EngineRegistryOptions = {
  /** Default: () => new PiEngineAdapter(). */
  readonly pi?: () => EnginePort;
  /** Default: lazy dynamic import of src/adapters/prime/engine-adapter.ts. */
  readonly prime?: () => EnginePort | Promise<EnginePort>;
  /** Default: () => new MockEnginePort(). */
  readonly mock?: () => EnginePort;
  /**
   * Test seam: prime adapter module specifier for the default lazy loader
   * (default "./prime/engine-adapter.ts"). Lets tests exercise the
   * module-absent fail-closed path deterministically without touching the
   * real adapter directory.
   */
  readonly primeModule?: string;
};

/** Default module specifier for the (parallel) prime engine adapter. */
const PRIME_ADAPTER_MODULE = "./prime/engine-adapter.ts";

/**
 * Lazily load the prime engine adapter via dynamic import.
 * Wrapped: a clear ENGINE_UNKNOWN error when the module is absent yet.
 */
async function loadPrimeEngineAdapter(
  moduleSpecifier: string,
): Promise<EnginePort> {
  let module: { PrimeEngineAdapter?: new () => EnginePort };
  try {
    module = (await import(moduleSpecifier)) as {
      PrimeEngineAdapter?: new () => EnginePort;
    };
  } catch (err) {
    throw new MediationError(
      "ENGINE_UNKNOWN",
      `Engine kind "prime" is not available: prime adapter module ` +
        `${moduleSpecifier} could not be loaded ` +
        `(cause: ${err instanceof Error ? err.message : String(err)})`,
      { engine: "prime", module: moduleSpecifier, cause: err },
    );
  }
  if (typeof module.PrimeEngineAdapter !== "function") {
    throw new MediationError(
      "ENGINE_UNKNOWN",
      `Engine kind "prime" is not available: ` +
        `${moduleSpecifier} does not export PrimeEngineAdapter`,
      { engine: "prime", module: moduleSpecifier },
    );
  }
  return new module.PrimeEngineAdapter();
}

/**
 * Build an EngineRegistry with lazy, memoized per-kind factories.
 * Unknown kinds → get() throws MediationError("ENGINE_UNKNOWN", …).
 */
export function createEngineRegistry(
  opts?: EngineRegistryOptions,
): EngineRegistry {
  const primeModuleSpecifier = opts?.primeModule ?? PRIME_ADAPTER_MODULE;
  const factories: Readonly<
    Record<EngineKind, () => EnginePort | Promise<EnginePort>>
  > = {
    pi: opts?.pi ?? (() => new PiEngineAdapter()),
    prime: opts?.prime ?? (() => loadPrimeEngineAdapter(primeModuleSpecifier)),
    mock: opts?.mock ?? (() => new MockEnginePort()),
  };

  // Memoized resolution promises (first get wins; later gets share it).
  const cache = new Map<EngineKind, Promise<EnginePort>>();

  function resolve(kind: EngineKind): Promise<EnginePort> {
    const cached = cache.get(kind);
    if (cached !== undefined) return cached;
    const promise = Promise.resolve().then(() => factories[kind]());
    // Do not memoize a failed load — a later get retries (e.g. the prime
    // adapter landing mid-process). The catch also guards the cached
    // promise from becoming an unhandled rejection.
    promise.catch(() => {
      if (cache.get(kind) === promise) cache.delete(kind);
    });
    cache.set(kind, promise);
    return promise;
  }

  return {
    async get(kind: EngineKind): Promise<EnginePort> {
      if (!isEngineKind(kind)) {
        throw new MediationError(
          "ENGINE_UNKNOWN",
          `Unknown engine kind "${String(kind)}" (expected one of: ${ENGINE_KINDS.join(", ")})`,
          { engine: kind, kinds: [...ENGINE_KINDS] },
        );
      }
      return await resolve(kind);
    },
    has(kind: EngineKind): boolean {
      return isEngineKind(kind);
    },
    kinds: ENGINE_KINDS,
  };
}
