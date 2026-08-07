/**
 * S2e integration: one AgentDefinition engaged via pi-fake and prime-fake
 * engines → both settle, same packSnapshot.planHash, per-engine sessionRef.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { MockEngineSessionHandle } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type { EnginePort, EngineRegistry } from "../../src/ports/engine.ts";
import type { OpenSessionRequest } from "../../src/ports/engine.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function fakePort(sessionRef: string): EnginePort {
  return {
    async openSession(_req: OpenSessionRequest) {
      return new MockEngineSessionHandle(asSessionRef(sessionRef));
    },
  };
}

describe("engine-selection: same agent on two engines (S2e)", () => {
  it("pi-fake and prime-fake both settle with identical packSnapshot.planHash", async () => {
    const pi = fakePort("pi-session-1");
    const prime = fakePort("prime-session-1");
    const registry: EngineRegistry = {
      get: async (kind) => (kind === "pi" ? pi : prime),
      has: (kind) => kind === "pi" || kind === "prime",
      kinds: ["pi", "prime"],
    };
    const factory = new DefaultPresenceFactory({
      registry,
      defaultEngine: "pi",
      toPackSnapshot,
      capabilityResolver: createCapabilityResolver(
        createFsCapabilityStore({ projectRoot: FIXTURE_ROOT, homeDir: NO_HOME }),
      ),
    });

    const definition = agentDefForPacks(FIXTURE_ROOT, ["foo", "bar"], "same-agent-s2e");

    // Same definition on pi
    const piPresence = await factory.materialize(definition, { engine: "pi" });
    const piOutcome = await piPresence.engage({ text: "hello pi" });
    assert.equal(piOutcome.kind, "settled");
    assert.equal(piPresence.sessionRef, "pi-session-1");

    // Same definition on prime
    const primePresence = await factory.materialize(definition, { engine: "prime" });
    const primeOutcome = await primePresence.engage({ text: "hello prime" });
    assert.equal(primeOutcome.kind, "settled");
    assert.equal(primePresence.sessionRef, "prime-session-1");

    // Engine choice is orthogonal to the agent: identical pack snapshot hash
    assert.equal(piPresence.packSnapshot.planHash, primePresence.packSnapshot.planHash);

    await piPresence.dispose();
    await primePresence.dispose();
  });
});
