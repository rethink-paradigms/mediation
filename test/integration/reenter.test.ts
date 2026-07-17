/**
 * S8: Mediation.reenter + reenterFromJoin (after S9 park continuum).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function makeMediation() {
  const join = new MemoryJoinStore();
  const factory = new DefaultPresenceFactory({
    engine: new MockEnginePort({
      sessionRefFactory: () => asSessionRef("reenter-sess"),
    }),
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: NO_HOME,
      }),
    ),
  });
  const loader = {
    load: async (ref: { name: string; rootDir: string }) =>
      agentDefForPacks(ref.rootDir, ["foo", "bar"], ref.name),
  };
  const mediation = new Mediation({ loader, factory, join });
  return { mediation, join, factory };
}

describe("Mediation.reenter (S8)", () => {
  it("cold engageLocal → reenter with pack gate → Settled", async () => {
    const { mediation } = makeMediation();
    const agent = { name: "reenter-agent", rootDir: FIXTURE_ROOT };

    const first = await mediation.engageLocal({
      agent,
      task: "first turn",
    });
    assert.equal(first.outcome.kind, "settled");
    assert.equal(first.sessionRef, "reenter-sess");
    assert.ok(first.packSnapshotHash);

    const again = await mediation.reenter({
      agent,
      sessionRef: asSessionRef(first.sessionRef!),
      task: "second turn",
      expectedPackSnapshotHash: first.packSnapshotHash,
      mode: "continue",
    });
    assert.equal(again.packSnapshotMatch, true);
    assert.equal(again.outcome.kind, "settled");
    assert.equal(again.sessionRef, "reenter-sess");
    assert.equal(again.packSnapshotHash, first.packSnapshotHash);
  });

  it("packSnapshot mismatch fails reenter without engage", async () => {
    const { mediation } = makeMediation();
    const agent = { name: "mismatch-agent", rootDir: FIXTURE_ROOT };

    const first = await mediation.engageLocal({ agent, task: "x" });
    const bad = await mediation.reenter({
      agent,
      sessionRef: asSessionRef(first.sessionRef!),
      task: "y",
      expectedPackSnapshotHash: "0".repeat(64),
    });
    assert.equal(bad.packSnapshotMatch, false);
    assert.equal(bad.outcome.kind, "failed");
    if (bad.outcome.kind === "failed") {
      assert.equal(bad.outcome.error.code, "PACK_SNAPSHOT_MISMATCH");
    }
  });

  it("park via engageLocal → reenter continue → Settled", async () => {
    const { mediation, join } = makeMediation();
    const agent = { name: "park-reenter", rootDir: FIXTURE_ROOT };

    const parked = await mediation.engageLocal({
      agent,
      task: "need help",
      parkIntent: true,
      parkReason: "await_human",
    });
    assert.equal(parked.outcome.kind, "parked");
    if (parked.outcome.kind !== "parked") return;

    await join.put({
      runId: asRunId("run-park-reenter"),
      sessionRef: asSessionRef(parked.sessionRef!),
      definitionId: parked.definitionId,
      packSnapshot: {
        planHash: parked.packSnapshotHash!,
        packs: [],
        createdAt: new Date().toISOString(),
      },
      status: "parked",
      parked: {
        reason: parked.outcome.reason,
        resumeToken: parked.outcome.resumeToken,
      },
      updatedAt: new Date().toISOString(),
    });

    const fromJoin = await mediation.reenterFromJoin(
      { runId: asRunId("run-park-reenter") },
      {
        agent,
        task: "human approved",
        mode: "continue",
        enforcePackSnapshot: true,
      },
    );
    assert.equal(fromJoin.packSnapshotMatch, true);
    assert.equal(fromJoin.outcome.kind, "settled");
    assert.equal(fromJoin.sessionRef, parked.sessionRef);
  });
});
