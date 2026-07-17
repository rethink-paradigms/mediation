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
});
