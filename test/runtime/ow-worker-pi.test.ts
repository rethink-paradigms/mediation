/**
 * S5d: OpenWorkflow worker + createPiPresenceFactory (fake Pi session).
 * dispatch → worker → completed with Settled-shaped output.
 * Default check — no live Pi keys.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";

import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { OpenWorkflowRuntime } from "../../src/adapters/openworkflow/runtime.ts";
import { registerEngagementWorkflow } from "../../src/adapters/openworkflow/register-engagement.ts";
import { ENGAGEMENT_WORKFLOW_NAME } from "../../src/adapters/openworkflow/types.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import { createPiPresenceFactory } from "../../src/adapters/wiring.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { FakePiSession } from "../pi/fake-session.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

let fakeSeq = 0;

function makePiFactory() {
  return createPiPresenceFactory({
    sessionFactory: async (req) => {
      fakeSeq += 1;
      const ref = req.resume
        ? String(req.resume)
        : `fake-session-s5d-${fakeSeq}`;
      const fake = new FakePiSession({
        sessionId: `sid-s5d-${fakeSeq}`,
        sessionFile: ref,
      });
      return { session: fake, sessionRefValue: ref };
    },
    fsStoreOptions: { homeDir: NO_HOME },
    projectRoot: FIXTURE_ROOT,
  });
}

describe("OW worker + Pi factory (S5d, fake session)", () => {
  const backend = BackendSqlite.connect(":memory:");
  const ow = new OpenWorkflow({ backend });
  const join = new MemoryJoinStore();
  const { factory, engine } = makePiFactory();

  const { engagementSpec } = registerEngagementWorkflow(ow, {
    factory,
    join,
    resolveDefinition: (inp) => {
      if (inp.agentName === "bad-packs-s5d") {
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

  const worker = ow.newWorker({ concurrency: 1 });
  let workerStarted = false;

  after(async () => {
    if (workerStarted) {
      await worker.stop();
    }
    await backend.stop();
  });

  it("dispatch → worker → wait completed Settled via Pi factory", async () => {
    await worker.start();
    workerStarted = true;

    const openedBefore = engine.opened.length;

    const handle = await runtime.dispatch({
      agent: { name: "case-basic-s5d", rootDir: FIXTURE_ROOT },
      task: "hello worker pi",
      clientRequestId: "s5d-dispatch-1",
    });

    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(
      status.state,
      "completed",
      `expected completed, got ${JSON.stringify(status)}`,
    );

    const result = status.result as {
      kind?: string;
      sessionRef?: string;
      packSnapshotHash?: string;
    };
    assert.equal(result?.kind, "settled");
    assert.ok(result?.sessionRef?.startsWith("fake-session-s5d-"));
    assert.equal(typeof result?.packSnapshotHash, "string");
    assert.equal(result?.packSnapshotHash?.length, 64);

    const record = await join.getByRunId(handle.runId);
    assert.ok(record);
    assert.equal(record.status, "settled");
    assert.equal(record.sessionRef, result.sessionRef);
    assert.equal(record.definitionId, "case-basic-s5d");
    assert.equal(record.packSnapshot.planHash, result.packSnapshotHash);

    assert.equal(engine.opened.length, openedBefore + 1);

    const owRun = await backend.getWorkflowRun({ workflowRunId: handle.runId });
    assert.ok(owRun);
    assert.equal(owRun.workflowName, ENGAGEMENT_WORKFLOW_NAME);
  });

  it("resume sessionRef through worker + Pi factory", async () => {
    if (!workerStarted) {
      await worker.start();
      workerStarted = true;
    }

    const resumeRef = "prior-session-s5d";
    const handle = await runtime.dispatch({
      agent: { name: "resume-s5d", rootDir: FIXTURE_ROOT },
      task: "continue worker pi",
      resume: asSessionRef(resumeRef),
      clientRequestId: "s5d-resume-1",
    });

    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(status.state, "completed");
    const result = status.result as { kind?: string; sessionRef?: string };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.sessionRef, resumeRef);

    const record = await join.getByRunId(handle.runId);
    assert.ok(record);
    assert.equal(record.sessionRef, resumeRef);
  });

  it("fail-closed pack → completed with failed leaf (Pi not opened for packs)", async () => {
    if (!workerStarted) {
      await worker.start();
      workerStarted = true;
    }

    const openedBefore = engine.opened.length;
    const handle = await runtime.dispatch({
      agent: { name: "bad-packs-s5d", rootDir: FIXTURE_ROOT },
      task: "should fail packs",
      clientRequestId: "s5d-fail-pack-1",
    });

    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(status.state, "completed");
    const result = status.result as {
      kind?: string;
      error?: { code?: string };
    };
    assert.equal(result?.kind, "failed");
    assert.equal(result?.error?.code, "CAPABILITY_RESOLVE_FAILED");
    assert.equal(engine.opened.length, openedBefore);
  });
});
