/**
 * S10: OpenWorkflow plan leaf — sequential PlanSpec nodes via runEngagementLeaf.
 * BackendSqlite + Worker + MockEnginePort; runtime.runPlan → wait → completed.
 * Default check — no live Pi keys.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";

import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { OpenWorkflowRuntime } from "../../src/adapters/openworkflow/runtime.ts";
import { registerPlanWorkflow } from "../../src/adapters/openworkflow/register-plan.ts";
import { PLAN_WORKFLOW_NAME } from "../../src/adapters/openworkflow/types.ts";
import {
  runPlanWorkflow,
  type PlanWorkflowOutput,
} from "../../src/adapters/openworkflow/workflows/plan.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type { PlanSpec } from "../../src/ports/runtime.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

function makeMockFactory(
  sessionRef = "mock-session-s10",
): DefaultPresenceFactory {
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

function resolveDefinition(inp: {
  agentName: string;
  agentRoot: string;
}) {
  // intentional missing pack for fail-closed plan node
  if (inp.agentName === "bad-packs-s10") {
    return agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "missing"],
      inp.agentName,
    );
  }
  return agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName);
}

describe("runPlanWorkflow pure body (S10, no OW)", () => {
  it("2-node sequential plan both Settled", async () => {
    const join = new MemoryJoinStore();
    const factory = makeMockFactory("mock-session-s10-pure");

    const plan: PlanSpec = {
      id: "plan-pure-2",
      nodes: [
        {
          id: "n1",
          agent: { name: "agent-a", rootDir: FIXTURE_ROOT },
          task: "step one",
        },
        {
          id: "n2",
          agent: { name: "agent-b", rootDir: FIXTURE_ROOT },
          task: "step two",
        },
      ],
    };

    const out = await runPlanWorkflow(plan, {
      factory,
      join,
      resolveDefinition,
      runId: "pure-plan-run",
    });

    assert.equal(out.kind, "completed");
    assert.equal(out.planId, "plan-pure-2");
    assert.equal(out.nodes.length, 2);
    assert.equal(out.nodes[0]?.nodeId, "n1");
    assert.equal(out.nodes[0]?.outcome.kind, "settled");
    assert.equal(out.nodes[1]?.nodeId, "n2");
    assert.equal(out.nodes[1]?.outcome.kind, "settled");

    const r1 = await join.getByRunId(asRunId("pure-plan-run:n1"));
    const r2 = await join.getByRunId(asRunId("pure-plan-run:n2"));
    assert.ok(r1);
    assert.ok(r2);
    assert.equal(r1.status, "settled");
    assert.equal(r2.status, "settled");
  });

  it("fail-closed missing pack on one node → plan kind failed, node failed", async () => {
    const join = new MemoryJoinStore();
    const factory = makeMockFactory("mock-session-s10-fail");

    const plan: PlanSpec = {
      id: "plan-fail-pack",
      nodes: [
        {
          id: "good",
          agent: { name: "agent-ok", rootDir: FIXTURE_ROOT },
          task: "ok",
        },
        {
          id: "bad",
          agent: { name: "bad-packs-s10", rootDir: FIXTURE_ROOT },
          task: "should fail packs",
        },
      ],
    };

    const out = await runPlanWorkflow(plan, {
      factory,
      join,
      resolveDefinition,
      runId: "pure-fail-run",
    });

    // Plan completes body with kind failed (not throw); node outcomes collected.
    assert.equal(out.kind, "failed");
    assert.equal(out.nodes.length, 2);
    assert.equal(out.nodes[0]?.outcome.kind, "settled");
    assert.equal(out.nodes[1]?.outcome.kind, "failed");
    if (out.nodes[1]?.outcome.kind === "failed") {
      assert.equal(out.nodes[1].outcome.error.code, "CAPABILITY_RESOLVE_FAILED");
    }
  });
});

describe("OW worker + plan leaf (S10, mock mind)", () => {
  const backend = BackendSqlite.connect(":memory:");
  const ow = new OpenWorkflow({ backend });
  const join = new MemoryJoinStore();
  const factory = makeMockFactory("mock-session-s10-ow");

  const { planSpec } = registerPlanWorkflow(ow, {
    factory,
    join,
    resolveDefinition,
  });

  const runtime = new OpenWorkflowRuntime({
    ow,
    backend: {
      getWorkflowRun: (params) => backend.getWorkflowRun(params),
    },
    planSpec,
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

  it("runPlan → worker → wait completed with 2 Settled nodes", async () => {
    await worker.start();
    workerStarted = true;

    const plan: PlanSpec = {
      id: "plan-s10-worker-2",
      nodes: [
        {
          id: "n1",
          agent: { name: "case-basic-s10-a", rootDir: FIXTURE_ROOT },
          task: "worker step one",
        },
        {
          id: "n2",
          agent: { name: "case-basic-s10-b", rootDir: FIXTURE_ROOT },
          task: "worker step two",
        },
      ],
    };

    const handle = await runtime.runPlan(plan);
    assert.ok(handle.runId.length > 0);

    const status = await runtime.wait(handle.runId, { timeoutMs: 15_000 });
    assert.equal(
      status.state,
      "completed",
      `expected completed, got ${JSON.stringify(status)}`,
    );

    const result = status.result as PlanWorkflowOutput;
    assert.equal(result?.kind, "completed");
    assert.equal(result?.planId, "plan-s10-worker-2");
    assert.equal(result?.nodes?.length, 2);
    assert.equal(result.nodes[0]?.nodeId, "n1");
    assert.equal(result.nodes[0]?.outcome.kind, "settled");
    assert.equal(result.nodes[1]?.nodeId, "n2");
    assert.equal(result.nodes[1]?.outcome.kind, "settled");

    // Product join correlated to OW run id + node id
    const j1 = await join.getByRunId(asRunId(`${handle.runId}:n1`));
    const j2 = await join.getByRunId(asRunId(`${handle.runId}:n2`));
    assert.ok(j1, "join row for plan node n1");
    assert.ok(j2, "join row for plan node n2");
    assert.equal(j1.status, "settled");
    assert.equal(j2.status, "settled");

    const owRun = await backend.getWorkflowRun({
      workflowRunId: handle.runId,
    });
    assert.ok(owRun);
    assert.equal(owRun.workflowName, PLAN_WORKFLOW_NAME);
    assert.ok(
      owRun.status === "completed" || owRun.status === "succeeded",
      `ow status=${owRun.status}`,
    );
  });

  it("fail-closed pack on plan node → OW completed with plan kind failed", async () => {
    if (!workerStarted) {
      await worker.start();
      workerStarted = true;
    }

    const plan: PlanSpec = {
      id: "plan-s10-fail-pack",
      nodes: [
        {
          id: "bad",
          agent: { name: "bad-packs-s10", rootDir: FIXTURE_ROOT },
          task: "should fail packs",
        },
      ],
    };

    const handle = await runtime.runPlan(plan);
    const status = await runtime.wait(handle.runId, { timeoutMs: 15_000 });
    // Workflow itself completes; plan output kind is failed (not OW crash)
    assert.equal(status.state, "completed");
    const result = status.result as PlanWorkflowOutput;
    assert.equal(result?.kind, "failed");
    assert.equal(result?.nodes?.[0]?.outcome.kind, "failed");
    if (result.nodes[0]?.outcome.kind === "failed") {
      assert.equal(result.nodes[0].outcome.error.code, "CAPABILITY_RESOLVE_FAILED");
    }
  });

  it("runPlan without planSpec still throws", async () => {
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
});
