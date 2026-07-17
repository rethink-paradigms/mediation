/**
 * Engagement arc scaffold — single leaf step, no wait yet (pre-LIFE-P1).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { runEngagementArc } from "../../src/adapters/openworkflow/workflows/engagement-arc.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

describe("runEngagementArc scaffold (pre-LIFE-P1)", () => {
  it("runs one leaf step via step.run and returns settled", async () => {
    const factory = new DefaultPresenceFactory({
      engine: new MockEnginePort(),
      toPackSnapshot,
      capabilityResolver: createCapabilityResolver(
        createFsCapabilityStore({
          projectRoot: FIXTURE_ROOT,
          homeDir: path.join(FIXTURE_ROOT, "_no_home"),
        }),
      ),
    });
    const join = new MemoryJoinStore();
    const stepNames: string[] = [];

    const outcome = await runEngagementArc({
      input: {
        agentName: "arc-scaffold",
        agentRoot: FIXTURE_ROOT,
        task: "hello arc",
      },
      runId: "arc-run-1",
      step: {
        async run(config, fn) {
          stepNames.push(config.name);
          return fn();
        },
      },
      deps: {
        factory,
        join,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      },
    });

    assert.deepEqual(stepNames, ["engagement-leaf"]);
    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.ok(outcome.sessionRef.length > 0);
      assert.equal(outcome.packSnapshotHash.length, 64);
    }
  });

  it("passes parkIntent through leaf → parked output (still completes arc scaffold)", async () => {
    const factory = new DefaultPresenceFactory({
      engine: new MockEnginePort(),
      toPackSnapshot,
      capabilityResolver: createCapabilityResolver(
        createFsCapabilityStore({
          projectRoot: FIXTURE_ROOT,
          homeDir: path.join(FIXTURE_ROOT, "_no_home"),
        }),
      ),
    });
    const join = new MemoryJoinStore();

    const outcome = await runEngagementArc({
      input: {
        agentName: "arc-park",
        agentRoot: FIXTURE_ROOT,
        task: "park me",
        parkIntent: true,
        parkReason: "scaffold-park",
      },
      runId: "arc-run-park",
      step: {
        async run(_config, fn) {
          return fn();
        },
      },
      deps: {
        factory,
        join,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      },
    });

    assert.equal(outcome.kind, "parked");
    if (outcome.kind === "parked") {
      assert.equal(outcome.reason, "scaffold-park");
    }
    // Scaffold: arc returns parked to caller — P1 will wait instead of completing OW run.
  });
});
