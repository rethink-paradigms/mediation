/**
 * S9: engage → Parked; rematerialize resume → continue → Settled.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { runEngagementLeaf } from "../../src/adapters/openworkflow/workflows/engagement.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../../src/adapters/packs/resolve-packs.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function makeFactory(engine: MockEnginePort): DefaultPresenceFactory {
  return new DefaultPresenceFactory({
    engine,
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: NO_HOME,
      }),
    ),
  });
}

describe("engage → Parked (S9)", () => {
  it("parkIntent → parked status + resumeToken", async () => {
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("park-sess-1"),
    });
    const factory = makeFactory(engine);
    const definition = agentDefForPacks(FIXTURE_ROOT, ["foo"], "park-agent");
    const presence = await factory.materialize(definition);

    const outcome = await presence.engage({
      text: "need human",
      parkIntent: true,
      parkReason: "await_human",
    });

    assert.equal(outcome.kind, "parked");
    if (outcome.kind === "parked") {
      assert.equal(outcome.sessionRef, "park-sess-1");
      assert.equal(outcome.reason, "await_human");
      assert.ok(outcome.resumeToken.startsWith("park:park-sess-1:"));
    }
    assert.equal(presence.status, "parked");
    await presence.dispose();
  });

  it("park → dispose → rematerialize resume → continue Settled", async () => {
    const engine = new MockEnginePort();
    const factory = makeFactory(engine);
    const definition = agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "bar"],
      "park-continue",
    );

    const first = await factory.materialize(definition);
    const sessionRef = first.sessionRef;
    const planHash = first.packSnapshot.planHash;

    const parked = await first.engage({
      text: "wait for signal",
      parkIntent: true,
    });
    assert.equal(parked.kind, "parked");
    await first.dispose();

    const second = await factory.materialize(definition, { resume: sessionRef });
    assert.equal(second.sessionRef, sessionRef);
    assert.equal(second.packSnapshot.planHash, planHash);

    const continued = await second.engage({
      text: "human said ok",
      mode: "continue",
    });
    assert.equal(continued.kind, "settled");
    if (continued.kind === "settled") {
      assert.equal(continued.sessionRef, sessionRef);
    }
    assert.equal(second.status, "idle");
    await second.dispose();
  });

  it("leaf writes join parked record", async () => {
    // Presence that parks: inject factory whose engage parks.
    // Simpler: use custom factory with mock engine + engage parkIntent via
    // wrapping PresenceFactory is hard. Call presence path through leaf with
    // a factory that always parks — use DefaultPresenceFactory and a thin
    // PresenceFactory wrapper.
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("leaf-park-sess"),
    });
    const inner = makeFactory(engine);
    const factory = {
      materialize: async (
        def: Parameters<DefaultPresenceFactory["materialize"]>[0],
        opts?: Parameters<DefaultPresenceFactory["materialize"]>[1],
      ) => {
        const p = await inner.materialize(def, opts);
        const orig = p.engage.bind(p);
        p.engage = async (input) =>
          orig({
            ...input,
            parkIntent: true,
            parkReason: "leaf_park",
          });
        return p;
      },
    };

    const join = new MemoryJoinStore();
    const runId = asRunId("run-leaf-park");
    const output = await runEngagementLeaf(
      {
        agentName: "leaf-park",
        agentRoot: FIXTURE_ROOT,
        task: "park me",
      },
      {
        factory,
        join,
        runId,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo"], inp.agentName),
      },
    );

    assert.equal(output.kind, "parked");
    if (output.kind === "parked") {
      assert.equal(output.reason, "leaf_park");
      assert.equal(output.sessionRef, "leaf-park-sess");
    }
    const record = await join.getByRunId(runId);
    assert.ok(record);
    assert.equal(record.status, "parked");
    assert.equal(record.parked?.reason, "leaf_park");
    assert.ok(record.parked?.resumeToken);
  });
});
