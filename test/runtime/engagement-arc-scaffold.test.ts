/**
 * Engagement arc — LIFE-P1 Model P park wait + settled path.
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
import { engagementWakeSignal } from "../../src/adapters/openworkflow/signals.ts";
import { runEngagementArc } from "../../src/adapters/openworkflow/workflows/engagement-arc.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

function makeFactory(): DefaultPresenceFactory {
  return new DefaultPresenceFactory({
    engine: new MockEnginePort(),
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: path.join(FIXTURE_ROOT, "_no_home"),
      }),
    ),
  });
}

describe("runEngagementArc (LIFE-P1)", () => {
  it("settled path: one leaf step, no waitForSignal", async () => {
    const factory = makeFactory();
    const join = new MemoryJoinStore();
    const stepNames: string[] = [];
    let waitCalled = false;

    const outcome = await runEngagementArc({
      input: {
        agentName: "arc-settled",
        agentRoot: FIXTURE_ROOT,
        task: "hello arc",
      },
      runId: "arc-run-1",
      step: {
        async run(config, fn) {
          stepNames.push(config.name);
          return fn();
        },
        async waitForSignal() {
          waitCalled = true;
          return { data: undefined };
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
    assert.equal(waitCalled, false);
    assert.equal(outcome.kind, "settled");
  });

  it("parked path: waitForSignal with wake address then return parked (P1 interim)", async () => {
    const factory = makeFactory();
    const join = new MemoryJoinStore();
    const runId = "arc-run-park";
    let waitedSignal: string | undefined;
    let waitStepName: string | undefined;

    const outcome = await runEngagementArc({
      input: {
        agentName: "arc-park",
        agentRoot: FIXTURE_ROOT,
        task: "park me",
        parkIntent: true,
        parkReason: "p1-park",
      },
      runId,
      step: {
        async run(_config, fn) {
          return fn();
        },
        async waitForSignal(opts) {
          waitedSignal = opts.signal;
          waitStepName = opts.name;
          return { data: { payloadText: "later" } as never };
        },
      },
      deps: {
        factory,
        join,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      },
    });

    assert.equal(waitedSignal, engagementWakeSignal(runId));
    assert.equal(waitStepName, "engagement-wake");
    assert.equal(outcome.kind, "parked");
    if (outcome.kind === "parked") {
      assert.equal(outcome.reason, "p1-park");
    }

    const record = await join.getByRunId(runId as never);
    assert.ok(record);
    assert.equal(record.status, "parked");
  });

  it("parked without waitForSignal → fail-closed PARK_WAIT_UNAVAILABLE", async () => {
    const factory = makeFactory();
    const join = new MemoryJoinStore();

    const outcome = await runEngagementArc({
      input: {
        agentName: "arc-no-wait",
        agentRoot: FIXTURE_ROOT,
        task: "park",
        parkIntent: true,
      },
      runId: "arc-run-no-wait",
      step: {
        async run(_config, fn) {
          return fn();
        },
        // waitForSignal omitted
      },
      deps: {
        factory,
        join,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      },
    });

    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") {
      assert.equal(outcome.error.code, "PARK_WAIT_UNAVAILABLE");
    }
  });
});
