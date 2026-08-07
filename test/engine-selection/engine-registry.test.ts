/**
 * S2e: createEngineRegistry — lazy + memoized, defaults constructible,
 * prime resolved via dynamic import (module-absent path fail-closed),
 * unknown kinds throw ENGINE_UNKNOWN.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEngineRegistry } from "../../src/adapters/engine-registry.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { PiEngineAdapter } from "../../src/adapters/pi/engine-adapter.ts";
import { MediationError } from "../../src/domain/errors.ts";
import { ENGINE_KINDS } from "../../src/domain/engine.ts";
import type { EnginePort } from "../../src/ports/engine.ts";

describe("createEngineRegistry (S2e)", () => {
  it("kinds lists pi | prime | mock in canonical order", () => {
    const registry = createEngineRegistry();
    assert.deepEqual([...registry.kinds], ENGINE_KINDS);
  });

  it("has() is true for known kinds, false otherwise", () => {
    const registry = createEngineRegistry();
    assert.equal(registry.has("pi"), true);
    assert.equal(registry.has("prime"), true);
    assert.equal(registry.has("mock"), true);
    assert.equal(
      registry.has("bogus" as Parameters<typeof registry.has>[0]),
      false,
    );
  });

  it("defaults constructible: pi → PiEngineAdapter, mock → MockEnginePort", async () => {
    const registry = createEngineRegistry();
    const pi = await registry.get("pi");
    assert.ok(pi instanceof PiEngineAdapter);
    const mock = await registry.get("mock");
    assert.ok(mock instanceof MockEnginePort);
  });

  it("prime resolves lazily via dynamic import to PrimeEngineAdapter", async () => {
    const registry = createEngineRegistry();
    const prime = await registry.get("prime");
    assert.ok(prime instanceof Object);
    // Dynamic import seam: PrimeEngineAdapter class name without static import
    // (static imports of adapters/prime are forbidden in this package).
    assert.equal(prime.constructor.name, "PrimeEngineAdapter");
  });

  it("module-absent prime → ENGINE_UNKNOWN with clear message (fail-closed)", async () => {
    const registry = createEngineRegistry({
      primeModule: "./prime/does-not-exist-s2e.ts",
    });
    await assert.rejects(
      () => registry.get("prime"),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "ENGINE_UNKNOWN");
        assert.match(err.message, /prime adapter module/u);
        assert.match(err.message, /does-not-exist-s2e/u);
        return true;
      },
    );
  });

  it("unknown kind get → ENGINE_UNKNOWN (fail-closed)", async () => {
    const registry = createEngineRegistry();
    await assert.rejects(
      () => registry.get("bogus" as never),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "ENGINE_UNKNOWN");
        assert.match(err.message, /Unknown engine kind/u);
        return true;
      },
    );
  });

  it("lazy: factory not invoked until first get", async () => {
    let calls = 0;
    const registry = createEngineRegistry({
      mock: () => {
        calls += 1;
        return new MockEnginePort();
      },
    });
    assert.equal(calls, 0, "factory must not run at registry creation");
    await registry.get("mock");
    assert.equal(calls, 1);
  });

  it("memoized: same instance returned for repeated gets", async () => {
    let calls = 0;
    const registry = createEngineRegistry({
      mock: () => {
        calls += 1;
        return new MockEnginePort();
      },
    });
    const a = await registry.get("mock");
    const b = await registry.get("mock");
    assert.equal(calls, 1, "factory must run exactly once");
    assert.equal(a, b, "same instance memoized");
  });

  it("concurrent gets share one resolution", async () => {
    let calls = 0;
    const registry = createEngineRegistry({
      mock: () => {
        calls += 1;
        return new MockEnginePort();
      },
    });
    const [a, b] = await Promise.all([
      registry.get("mock"),
      registry.get("mock"),
    ]);
    assert.equal(calls, 1);
    assert.equal(a, b);
  });

  it("custom factories override defaults", async () => {
    const custom: EnginePort = new MockEnginePort();
    const registry = createEngineRegistry({
      pi: () => custom,
    });
    assert.equal(await registry.get("pi"), custom);
    assert.equal(await registry.get("pi"), custom);
  });

  it("async custom factory supported (prime seam shape)", async () => {
    const custom: EnginePort = new MockEnginePort();
    const registry = createEngineRegistry({
      prime: async () => custom,
    });
    assert.equal(await registry.get("prime"), custom);
  });

  it("failed lazy load is not memoized — later get retries", async () => {
    let calls = 0;
    const registry = createEngineRegistry({
      mock: () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return new MockEnginePort();
      },
    });
    await assert.rejects(() => registry.get("mock"), /transient/u);
    const port = await registry.get("mock");
    assert.ok(port instanceof MockEnginePort);
    assert.equal(calls, 2);
  });
});
