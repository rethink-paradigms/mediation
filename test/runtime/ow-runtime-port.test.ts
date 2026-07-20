/**
 * S5a: OpenWorkflowRuntime (RuntimePort) against real openworkflow client + sqlite.
 * No worker — dispatch leaves runs pending; cancel / status / signal still prove client shape.
 */

import assert from "node:assert/strict";
import { describe, it, after } from "node:test";

import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

import {
  OpenWorkflowRuntime,
  defaultEngagementWorkflowSpec,
  defaultPlanWorkflowSpec,
  type RuntimeOwClient,
} from "../../src/adapters/openworkflow/runtime.ts";
import { ENGAGEMENT_WORKFLOW_NAME } from "../../src/adapters/openworkflow/types.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";

describe("OpenWorkflowRuntime (live OW client, no worker)", () => {
  const backend = BackendSqlite.connect(":memory:");
  const ow = new OpenWorkflow({ backend }) as unknown as RuntimeOwClient;
  const runtime = new OpenWorkflowRuntime({
    ow,
    backend: {
      getWorkflowRun: (params) => backend.getWorkflowRun(params),
    },
    engagementSpec: defaultEngagementWorkflowSpec(),
    planSpec: defaultPlanWorkflowSpec(),
    pollIntervalMs: 20,
  });

  after(async () => {
    await backend.stop();
  });

  it("dispatch returns runId and getStatus is pending without worker", async () => {
    const handle = await runtime.dispatch({
      agent: { name: "case-basic", rootDir: "/tmp/agents/case-basic" },
      task: "prove runtime dispatch",
      clientRequestId: "s5a-dispatch-1",
    });

    assert.equal(typeof handle.runId, "string");
    assert.ok(handle.runId.length > 0);

    const status = await runtime.getStatus(handle.runId);
    assert.equal(status.state, "pending");

    const run = await backend.getWorkflowRun({ workflowRunId: handle.runId });
    assert.ok(run);
    assert.equal(run.workflowName, ENGAGEMENT_WORKFLOW_NAME);
    assert.equal(run.status, "pending");
    // Input is serializable engagement payload
    assert.ok(run.input && typeof run.input === "object");
    const input = run.input as Record<string, unknown>;
    assert.equal(input["agentName"], "case-basic");
    assert.equal(input["task"], "prove runtime dispatch");
  });

  it("idempotencyKey reuses clientRequestId", async () => {
    const a = await runtime.dispatch({
      agent: { name: "a", rootDir: "/tmp/a" },
      task: "once",
      clientRequestId: "s5a-idem-key",
    });
    const b = await runtime.dispatch({
      agent: { name: "a", rootDir: "/tmp/a" },
      task: "once",
      clientRequestId: "s5a-idem-key",
    });
    assert.equal(a.runId, b.runId);
  });

  it("cancel moves pending run to canceled", async () => {
    const handle = await runtime.dispatch({
      agent: { name: "cancel-me", rootDir: "/tmp/c" },
      task: "cancel path",
      clientRequestId: "s5a-cancel-1",
    });
    await runtime.cancel(handle.runId);
    const status = await runtime.getStatus(handle.runId);
    assert.equal(status.state, "canceled");
  });

  it("sendSignal does not throw (no waiter → empty delivery)", async () => {
    const handle = await runtime.dispatch({
      agent: { name: "sig", rootDir: "/tmp/s" },
      task: "signal",
      clientRequestId: "s5a-signal-1",
    });
    await runtime.sendSignal(handle.runId, "wake", { ok: true });
    // still pending without worker
    assert.equal((await runtime.getStatus(handle.runId)).state, "pending");
  });

  it("wait times out while pending without worker", async () => {
    const handle = await runtime.dispatch({
      agent: { name: "wait", rootDir: "/tmp/w" },
      task: "timeout",
      clientRequestId: "s5a-wait-1",
    });
    const status = await runtime.wait(handle.runId, { timeoutMs: 80 });
    assert.equal(status.state, "failed");
    if (status.state === "failed") {
      const err = status.error as { code?: string; message?: string };
      assert.equal(err?.code, "WAIT_TIMEOUT");
    }
  });

  it("wait returns canceled when run canceled mid-wait", async () => {
    const handle = await runtime.dispatch({
      agent: { name: "wait-cancel", rootDir: "/tmp/wc" },
      task: "cancel mid wait",
      clientRequestId: "s5a-wait-cancel",
    });
    const waitP = runtime.wait(handle.runId, { timeoutMs: 2000 });
    // cancel shortly after wait starts
    setTimeout(() => {
      void runtime.cancel(handle.runId);
    }, 30);
    const status = await waitP;
    assert.equal(status.state, "canceled");
  });

  it("runPlan enqueues plan workflow when planSpec configured", async () => {
    const handle = await runtime.runPlan({
      id: "plan-s5a-1",
      nodes: [
        {
          id: "n1",
          agent: { name: "a", rootDir: "/tmp/a" },
          task: "step one",
        },
      ],
    });
    assert.ok(handle.runId);
    const run = await backend.getWorkflowRun({ workflowRunId: handle.runId });
    assert.equal(run?.workflowName, "mediation-plan");
    assert.equal((await runtime.getStatus(handle.runId)).state, "pending");
  });

  it("runPlan without planSpec throws", async () => {
    const thin = new OpenWorkflowRuntime({
      ow,
      backend: {
        getWorkflowRun: (params) => backend.getWorkflowRun(params),
      },
      // no planSpec
    });
    await assert.rejects(
      () =>
        thin.runPlan({
          id: "nope",
          nodes: [],
        }),
      /no planSpec configured/u,
    );
  });

  it("getStatus unknown runId → failed RUN_NOT_FOUND", async () => {
    const status = await runtime.getStatus(asRunId("does-not-exist"));
    assert.equal(status.state, "failed");
    if (status.state === "failed") {
      const err = status.error as { code?: string };
      assert.equal(err?.code, "RUN_NOT_FOUND");
    }
  });

  it("dispatch maps resume SessionRef into engagement input", async () => {
    const handle = await runtime.dispatch({
      agent: { name: "resume", rootDir: "/tmp/r" },
      task: "resume task",
      resume: asSessionRef("session-prior-1"),
      clientRequestId: "s5a-resume-map",
    });
    const run = await backend.getWorkflowRun({ workflowRunId: handle.runId });
    const input = run?.input as Record<string, unknown>;
    assert.equal(input["sessionRef"], "session-prior-1");
  });
});

describe("OpenWorkflowRuntime with mock client (unit)", () => {
  it("maps OW statuses through getStatus", async () => {
    const runs = new Map<
      string,
      { id: string; status: string; output?: unknown; error?: unknown }
    >();
    runs.set("r1", { id: "r1", status: "running" });
    runs.set("r2", { id: "r2", status: "sleeping" });
    runs.set("r3", { id: "r3", status: "completed", output: { ok: true } });
    runs.set("r4", { id: "r4", status: "failed", error: { message: "boom" } });
    runs.set("r5", { id: "r5", status: "succeeded", output: 42 });

    const mockOw: RuntimeOwClient = {
      async runWorkflow() {
        return { workflowRun: { id: "new", status: "pending" } };
      },
      async cancelWorkflowRun() {},
      async sendSignal() {
        return { workflowRunIds: [] };
      },
    };

    const runtime = new OpenWorkflowRuntime({
      ow: mockOw,
      backend: {
        async getWorkflowRun({ workflowRunId }) {
          return runs.get(workflowRunId) ?? null;
        },
      },
      engagementSpec: { name: "mock-eng" },
    });

    assert.equal((await runtime.getStatus(asRunId("r1"))).state, "running");
    const sleeping = await runtime.getStatus(asRunId("r2"));
    assert.equal(sleeping.state, "running");
    if (sleeping.state === "running") {
      assert.equal(sleeping.parked, true);
    }
    const done = await runtime.getStatus(asRunId("r3"));
    assert.equal(done.state, "completed");
    if (done.state === "completed") {
      assert.deepEqual(done.result, { ok: true });
    }
    assert.equal((await runtime.getStatus(asRunId("r4"))).state, "failed");
    assert.equal((await runtime.getStatus(asRunId("r5"))).state, "completed");
  });
});
