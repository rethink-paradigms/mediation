/**
 * S5c: OpenWorkflow worker executes engagement leaf (mock mind).
 * dispatch → worker → completed with Settled-shaped output.
 * Default check — no live Pi keys.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { OpenWorkflowRuntime } from "../../src/adapters/openworkflow/runtime.ts";
import { registerEngagementWorkflow } from "../../src/adapters/openworkflow/register-engagement.ts";
import { ENGAGEMENT_WORKFLOW_NAME } from "../../src/adapters/openworkflow/types.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

function makeMockFactory(sessionRef = "mock-session-s5c"): DefaultPresenceFactory {
  const engine = new MockEnginePort({
    sessionRefFactory: () => asSessionRef(sessionRef),
  });
  return new DefaultPresenceFactory({
    engine,
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: path.join(FIXTURE_ROOT, "_no_home"),
      }),
    ),
  });
}

describe("OW worker + engagement leaf (S5c, mock mind)", () => {
  const backend = BackendSqlite.connect(":memory:");
  const ow = new OpenWorkflow({ backend });
  const join = new MemoryJoinStore();
  const factory = makeMockFactory("mock-session-s5c");

  const { engagementSpec } = registerEngagementWorkflow(ow, {
    factory,
    join,
    resolveDefinition: (inp) => {
      // intentional missing pack for fail-closed worker case
      if (inp.agentName === "bad-packs-s5c") {
        return agentDefForPacks(
          FIXTURE_ROOT,
          ["foo", "missing"],
          inp.agentName,
        );
      }
      return agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName);
    },
  });

  const runtime = new OpenWorkflowRuntime({
    ow,
    backend: {
      getWorkflowRun: (params) => backend.getWorkflowRun(params),
    },
    engagementSpec,
    pollIntervalMs: 15,
  });

  const worker = ow.newWorker({ concurrency: 2 });
  let workerStarted = false;

  after(async () => {
    if (workerStarted) {
      await worker.stop();
    }
    await backend.stop();
  });

  it("dispatch → worker → wait completed with Settled-shaped output", async () => {
    await worker.start();
    workerStarted = true;

    const handle = await runtime.dispatch({
      agent: { name: "case-basic-s5c", rootDir: FIXTURE_ROOT },
      task: "hello worker leaf",
      clientRequestId: "s5c-dispatch-1",
    });

    assert.ok(handle.runId.length > 0);

    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(status.state, "completed", `expected completed, got ${JSON.stringify(status)}`);

    const result = status.result as {
      kind?: string;
      sessionRef?: string;
      packSnapshotHash?: string;
    };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.sessionRef, "mock-session-s5c");
    assert.equal(typeof result?.packSnapshotHash, "string");
    assert.equal(result?.packSnapshotHash?.length, 64);

    // Product join correlated to OW run id
    const record = await join.getByRunId(handle.runId);
    assert.ok(record, "join row for OW runId");
    assert.equal(record.status, "settled");
    assert.equal(record.sessionRef, "mock-session-s5c");
    assert.equal(record.definitionId, "case-basic-s5c");
    assert.equal(record.packSnapshot.planHash, result.packSnapshotHash);

    const owRun = await backend.getWorkflowRun({ workflowRunId: handle.runId });
    assert.ok(owRun);
    assert.equal(owRun.workflowName, ENGAGEMENT_WORKFLOW_NAME);
    assert.ok(
      owRun.status === "completed" || owRun.status === "succeeded",
      `ow status=${owRun.status}`,
    );
  });

  it("resume sessionRef through worker path", async () => {
    if (!workerStarted) {
      await worker.start();
      workerStarted = true;
    }

    const resumeRef = "prior-session-s5c";
    // MockEnginePort.openSession uses req.resume when present.
    const handle = await runtime.dispatch({
      agent: { name: "resume-s5c", rootDir: FIXTURE_ROOT },
      task: "continue on worker",
      resume: asSessionRef(resumeRef),
      clientRequestId: "s5c-resume-1",
    });

    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(status.state, "completed");
    const result = status.result as { kind?: string; sessionRef?: string };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.sessionRef, resumeRef);

    const record = await join.getByRunId(handle.runId);
    assert.ok(record);
    assert.equal(record.status, "settled");
    assert.equal(record.sessionRef, resumeRef);
  });

  it("fail-closed pack → completed run with failed leaf output", async () => {
    if (!workerStarted) {
      await worker.start();
      workerStarted = true;
    }

    // resolveDefinition maps bad-packs-s5c → missing pack (see registration).
    const handle = await runtime.dispatch({
      agent: { name: "bad-packs-s5c", rootDir: FIXTURE_ROOT },
      task: "should fail packs",
      clientRequestId: "s5c-fail-pack-1",
    });

    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    // Workflow itself completes; leaf output kind is failed (not OW crash)
    assert.equal(status.state, "completed");
    const result = status.result as {
      kind?: string;
      error?: { code?: string };
    };
    assert.equal(result?.kind, "failed");
    assert.equal(result?.error?.code, "CAPABILITY_RESOLVE_FAILED");
  });

  it("LIFE-P1/P2: parkIntent → wait → wake continue → Settled", async () => {
    if (!workerStarted) {
      await worker.start();
      workerStarted = true;
    }

    const handle = await runtime.dispatch({
      agent: { name: "park-s5c-p2", rootDir: FIXTURE_ROOT },
      task: "park on worker",
      parkIntent: true,
      parkReason: "worker-p2-park",
      clientRequestId: "s5c-park-p2-1",
    });

    // Poll until leaf has parked (join) while OW run still open (Model P).
    const deadline = Date.now() + 8_000;
    let parkedJoin = await join.getByRunId(handle.runId);
    let mid = await runtime.getStatus(handle.runId);
    while (Date.now() < deadline) {
      if (
        mid.state === "completed" ||
        mid.state === "failed" ||
        mid.state === "canceled"
      ) {
        break;
      }
      if (parkedJoin?.status === "parked") {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
      parkedJoin = await join.getByRunId(handle.runId);
      mid = await runtime.getStatus(handle.runId);
    }

    assert.ok(parkedJoin, "join row after leaf park");
    assert.equal(parkedJoin.status, "parked");
    assert.notEqual(
      mid.state,
      "completed",
      `expected non-completed while parked-wait, got ${JSON.stringify(mid)}`,
    );
    assert.notEqual(mid.state, "failed", `unexpected fail: ${JSON.stringify(mid)}`);
    assert.notEqual(mid.state, "canceled");

    const sessionBefore = parkedJoin.sessionRef;

    // Wake → continue leaf (LIFE-P2) on same runId.
    await runtime.sendSignal(handle.runId, "wake", {
      payloadText: "human continues",
      mode: "continue",
    });

    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(
      status.state,
      "completed",
      `expected completed after wake continue, got ${JSON.stringify(status)}`,
    );
    const result = status.result as {
      kind?: string;
      sessionRef?: string;
      packSnapshotHash?: string;
    };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.sessionRef, sessionBefore);
    assert.equal(typeof result?.packSnapshotHash, "string");

    const settledJoin = await join.getByRunId(handle.runId);
    assert.ok(settledJoin);
    assert.equal(settledJoin.status, "settled");
    assert.equal(settledJoin.sessionRef, sessionBefore);
  });
});
