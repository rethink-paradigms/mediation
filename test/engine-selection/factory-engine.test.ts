/**
 * S2e: DefaultPresenceFactory engine selection —
 *   - registry + per-call MaterializeOptions.engine picks the right port
 *   - precedence: override > definition.engine (config) > defaultEngine > "pi"
 *   - legacy engine-only deps behave exactly as before (no regression)
 *   - both/neither engine|registry → wiring error
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createEngineRegistry } from "../../src/adapters/engine-registry.ts";
import { MockEnginePort, MockEngineSessionHandle } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";
import { MediationError } from "../../src/domain/errors.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type { EnginePort, EngineRegistry } from "../../src/ports/engine.ts";
import type { OpenSessionRequest } from "../../src/ports/engine.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function capabilityResolver() {
  return createCapabilityResolver(
    createFsCapabilityStore({ projectRoot: FIXTURE_ROOT, homeDir: NO_HOME }),
  );
}

/** Counting EnginePort fake keyed by a sessionRef. */
function countingPort(_name: string, sessionRef: string): EnginePort & { opened: number } {
  const port: EnginePort & { opened: number } = {
    opened: 0,
    async openSession(_req: OpenSessionRequest) {
      port.opened += 1;
      return new MockEngineSessionHandle(asSessionRef(sessionRef));
    },
  };
  return port;
}

function registryWith(ports: Record<string, EnginePort>): EngineRegistry {
  return {
    async get(kind) {
      const port = ports[kind];
      if (!port) throw new MediationError("ENGINE_UNKNOWN", `no fake for ${kind}`);
      return port;
    },
    has(kind) {
      return kind in ports;
    },
    kinds: Object.keys(ports) as never,
  };
}

const DEF: AgentDefinition = {
  id: "factory-s2e",
  name: "factory-s2e",
  rootDir: FIXTURE_ROOT,
  model: "test/model",
  extensions: ["foo", "bar"],
};

describe("DefaultPresenceFactory engine selection (S2e)", () => {
  it("registry + per-call MaterializeOptions.engine picks the right port", async () => {
    const pi = countingPort("pi", "pi-sess");
    const prime = countingPort("prime", "prime-sess");
    const mock = countingPort("mock", "mock-sess");
    const factory = new DefaultPresenceFactory({
      registry: registryWith({ pi, prime, mock }),
      defaultEngine: "mock",
      toPackSnapshot,
      capabilityResolver: capabilityResolver(),
    });

    const a = await factory.materialize(DEF, { engine: "pi" });
    assert.equal(a.sessionRef, "pi-sess");
    assert.equal(pi.opened, 1);
    assert.equal(prime.opened, 0);
    assert.equal(mock.opened, 0);
    await a.dispose();

    const b = await factory.materialize(DEF, { engine: "prime" });
    assert.equal(b.sessionRef, "prime-sess");
    assert.equal(prime.opened, 1);
    assert.equal(pi.opened, 1);
    await b.dispose();
  });

  it("precedence: override > definition.engine (config) > defaultEngine > pi", async () => {
    const pi = countingPort("pi", "pi-sess");
    const prime = countingPort("prime", "prime-sess");
    const mock = countingPort("mock", "mock-sess");
    const factory = new DefaultPresenceFactory({
      registry: registryWith({ pi, prime, mock }),
      toPackSnapshot,
      capabilityResolver: capabilityResolver(),
    });

    // no override, no definition.engine, no defaultEngine → built-in pi
    const p = await factory.materialize(DEF);
    assert.equal(p.sessionRef, "pi-sess");
    await p.dispose();

    // definition.engine (config layer) beats defaultEngine + built-in pi
    const withDef = { ...DEF, engine: "prime" as const };
    const q = await factory.materialize(withDef, {});
    assert.equal(q.sessionRef, "prime-sess");
    await q.dispose();

    // per-call override beats definition.engine
    const r = await factory.materialize(withDef, { engine: "mock" });
    assert.equal(r.sessionRef, "mock-sess");
    await r.dispose();
  });

  it("defaultEngine composition fallback (mock) is used when nothing else", async () => {
    const pi = countingPort("pi", "pi-sess");
    const mock = countingPort("mock", "mock-sess");
    const factory = new DefaultPresenceFactory({
      registry: registryWith({ pi, mock }),
      defaultEngine: "mock",
      toPackSnapshot,
      capabilityResolver: capabilityResolver(),
    });
    const presence = await factory.materialize(DEF, {});
    assert.equal(presence.sessionRef, "mock-sess");
    assert.equal(mock.opened, 1);
    assert.equal(pi.opened, 0);
    await presence.dispose();
  });

  it("unknown engine override → ENGINE_UNKNOWN propagates fail-closed", async () => {
    const factory = new DefaultPresenceFactory({
      registry: createEngineRegistry(),
      toPackSnapshot,
      capabilityResolver: capabilityResolver(),
    });
    await assert.rejects(
      () => factory.materialize(DEF, { engine: "bogus" as never }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "ENGINE_UNKNOWN");
        return true;
      },
    );
  });

  it("legacy engine-only deps behave exactly as before (no regression)", async () => {
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("legacy-sess"),
    });
    const factory = new DefaultPresenceFactory({
      engine,
      toPackSnapshot,
      capabilityResolver: capabilityResolver(),
    });
    // even with an engine override, the legacy single-engine path ignores it
    const presence = await factory.materialize(DEF, { engine: "prime" });
    assert.equal(presence.sessionRef, "legacy-sess");
    assert.equal(engine.opened.length, 1);
    const outcome = await presence.engage({ text: "hi" });
    assert.equal(outcome.kind, "settled");
    await presence.dispose();
  });

  it("wiring error: neither engine nor registry", () => {
    assert.throws(
      () =>
        new DefaultPresenceFactory({
          toPackSnapshot,
          capabilityResolver: capabilityResolver(),
        }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "ENGINE_UNKNOWN");
        assert.match(err.message, /exactly one/u);
        return true;
      },
    );
  });

  it("wiring error: both engine and registry provided", () => {
    assert.throws(
      () =>
        new DefaultPresenceFactory({
          engine: new MockEnginePort(),
          registry: createEngineRegistry(),
          toPackSnapshot,
          capabilityResolver: capabilityResolver(),
        }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "ENGINE_UNKNOWN");
        assert.match(err.message, /exactly one/u);
        return true;
      },
    );
  });
});
