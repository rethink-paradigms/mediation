/**
 * Engagement arc — LIFE-P1 wait + LIFE-P2 wake continue.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { engagementWakeSignal } from "../../src/adapters/openworkflow/signals.ts";
import {
  ENGAGEMENT_ARC_MAX_PARK_LOOPS,
  runEngagementArc,
} from "../../src/adapters/openworkflow/workflows/engagement-arc.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

function makeFactory(sessionRef?: string): DefaultPresenceFactory {
  return new DefaultPresenceFactory({
    engine: new MockEnginePort({
      sessionRefFactory: sessionRef
        ? () => asSessionRef(sessionRef)
        : undefined,
    }),
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: path.join(FIXTURE_ROOT, "_no_home"),
      }),
    ),
  });
}

describe("runEngagementArc (LIFE-P1/P2)", () => {
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

  it("LIFE-P2: park → wake → continue leaf Settled (same sessionRef)", async () => {
    const sessionRef = "arc-session-p2";
    const factory = makeFactory(sessionRef);
    const join = new MemoryJoinStore();
    const runId = "arc-run-p2";
    const stepNames: string[] = [];
    let waitedSignal: string | undefined;
    let continueTask: string | undefined;
    let continueMode: string | undefined;
    let continueSession: string | undefined;

    const outcome = await runEngagementArc({
      input: {
        agentName: "arc-p2",
        agentRoot: FIXTURE_ROOT,
        task: "first park",
        parkIntent: true,
        parkReason: "need-human",
      },
      runId,
      step: {
        async run(config, fn) {
          stepNames.push(config.name);
          // Capture continue leaf input via resolveDefinition side channel:
          // inspect is hard; use a wrapper on resolve that reads nothing —
          // instead spy by wrapping leaf via task only after wake.
          return fn();
        },
        async waitForSignal(opts) {
          waitedSignal = opts.signal;
          return {
            data: {
              payloadText: "human says go",
              mode: "continue",
            } as never,
          };
        },
      },
      deps: {
        factory,
        join,
        resolveDefinition: (inp) => {
          if (inp.engageMode === "continue" || inp.sessionRef) {
            continueTask = inp.task;
            continueMode = inp.engageMode;
            continueSession = inp.sessionRef;
          }
          return agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName);
        },
      },
    });

    assert.equal(waitedSignal, engagementWakeSignal(runId));
    assert.deepEqual(stepNames, ["engagement-leaf", "engagement-continue-1"]);
    assert.equal(continueTask, "human says go");
    assert.equal(continueMode, "continue");
    assert.equal(continueSession, sessionRef);
    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, sessionRef);
    }

    const record = await join.getByRunId(runId as never);
    assert.ok(record);
    assert.equal(record.status, "settled");
    assert.equal(record.sessionRef, sessionRef);
  });

  it("LIFE-P2: re-park once then settle", async () => {
    const factory = makeFactory("arc-repark-sess");
    const join = new MemoryJoinStore();
    const runId = "arc-run-repark";
    const stepNames: string[] = [];
    let wakeCount = 0;

    const outcome = await runEngagementArc({
      input: {
        agentName: "arc-repark",
        agentRoot: FIXTURE_ROOT,
        task: "park 1",
        parkIntent: true,
        parkReason: "first",
      },
      runId,
      step: {
        async run(config, fn) {
          stepNames.push(config.name);
          return fn();
        },
        async waitForSignal() {
          wakeCount += 1;
          if (wakeCount === 1) {
            return {
              data: {
                payloadText: "still waiting",
                parkIntent: true,
                parkReason: "second",
              } as never,
            };
          }
          return {
            data: { payloadText: "done now", mode: "continue" } as never,
          };
        },
      },
      deps: {
        factory,
        join,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      },
    });

    assert.equal(wakeCount, 2);
    assert.deepEqual(stepNames, [
      "engagement-leaf",
      "engagement-continue-1",
      "engagement-continue-2",
    ]);
    assert.equal(outcome.kind, "settled");
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

  it("exports max park loop constant", () => {
    assert.equal(ENGAGEMENT_ARC_MAX_PARK_LOOPS, 32);
  });
});
