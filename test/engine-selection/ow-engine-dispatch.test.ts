/**
 * S2e hosted dispatch serialization:
 *   DispatchInput.engine → EngagementWorkflowInput.engine (worker input)
 *   → leaf materializes via registry-backed factory with that engine
 *   → join record stores engine → output variants carry engine.
 * Also: planNodeToEngagementInput forwards per-node engine.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";

import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort, MockEngineSessionHandle } from "../../src/adapters/mock/engine-adapter.ts";
import { OpenWorkflowRuntime } from "../../src/adapters/openworkflow/runtime.ts";
import { registerEngagementWorkflow } from "../../src/adapters/openworkflow/register-engagement.ts";
import { planNodeToEngagementInput } from "../../src/adapters/openworkflow/workflows/plan.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { MediationError } from "../../src/domain/errors.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type { EnginePort, EngineRegistry } from "../../src/ports/engine.ts";
import type { OpenSessionRequest } from "../../src/ports/engine.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

/** Counting fake port with a per-kind sessionRef. */
function fakePort(kind: string): EnginePort & { opened: number } {
  const port: EnginePort & { opened: number } = {
    opened: 0,
    async openSession(_req: OpenSessionRequest) {
      port.opened += 1;
      return new MockEngineSessionHandle(asSessionRef(`${kind}-session`));
    },
  };
  return port;
}

function fakeRegistry(ports: Record<string, EnginePort>): EngineRegistry {
  return {
    async get(kind) {
      const port = ports[kind];
      if (!port) throw new MediationError("ENGINE_UNKNOWN", `no fake port ${kind}`);
      return port;
    },
    has(kind) {
      return kind in ports;
    },
    kinds: Object.keys(ports) as never,
  };
}

describe("OW engine dispatch serialization (S2e)", () => {
  const backend = BackendSqlite.connect(":memory:");
  const ow = new OpenWorkflow({ backend });
  const join = new MemoryJoinStore();

  const pi = fakePort("pi");
  const prime = fakePort("prime");
  const mock = fakePort("mock");

  const factory = new DefaultPresenceFactory({
    registry: fakeRegistry({ pi, prime, mock }),
    defaultEngine: "mock",
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({ projectRoot: FIXTURE_ROOT, homeDir: NO_HOME }),
    ),
  });

  const { engagementSpec } = registerEngagementWorkflow(ow, {
    factory,
    join,
    defaultEngine: "mock",
    resolveDefinition: (inp) =>
      agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
  });

  const runtime = new OpenWorkflowRuntime({
    ow,
    backend: { getWorkflowRun: (params) => backend.getWorkflowRun(params) },
    engagementSpec,
    pollIntervalMs: 15,
  });

  const worker = ow.newWorker({ concurrency: 2 });
  let workerStarted = false;

  after(async () => {
    if (workerStarted) await worker.stop();
    await backend.stop();
  });

  it("dispatch engine:prime → input.engine on worker → prime materialize → join+output engine", async () => {
    await worker.start();
    workerStarted = true;

    const handle = await runtime.dispatch({
      agent: { name: "ow-s2e-prime", rootDir: FIXTURE_ROOT },
      task: "run on prime",
      engine: "prime",
      clientRequestId: "s2e-ow-prime-1",
    });

    // Serialization: the workflow input the worker sees carries engine.
    const owRun = await backend.getWorkflowRun({ workflowRunId: handle.runId });
    assert.ok(owRun);
    const input = owRun.input as Record<string, unknown>;
    assert.equal(input["engine"], "prime");
    assert.equal(input["agentName"], "ow-s2e-prime");

    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(status.state, "completed", JSON.stringify(status));
    const result = status.result as { kind?: string; engine?: string; sessionRef?: string };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.engine, "prime");
    assert.equal(result?.sessionRef, "prime-session");

    // Join record stores engine; prime port was the only one opened.
    const record = await join.getByRunId(handle.runId);
    assert.ok(record);
    assert.equal(record.engine, "prime");
    assert.equal(record.status, "settled");
    assert.equal(prime.opened, 1);
    assert.equal(pi.opened, 0);
    assert.equal(mock.opened, 0);
  });

  it("dispatch without engine → composition default mock (engine field round-trip)", async () => {
    if (!workerStarted) {
      await worker.start();
      workerStarted = true;
    }
    const before = mock.opened;
    const handle = await runtime.dispatch({
      agent: { name: "ow-s2e-default", rootDir: FIXTURE_ROOT },
      task: "default engine",
      clientRequestId: "s2e-ow-default-1",
    });
    const owRun = await backend.getWorkflowRun({ workflowRunId: handle.runId });
    assert.ok(owRun);
    assert.equal((owRun.input as Record<string, unknown>)["engine"], undefined);

    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(status.state, "completed", JSON.stringify(status));
    const result = status.result as { kind?: string; engine?: string };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.engine, "mock");

    const record = await join.getByRunId(handle.runId);
    assert.ok(record);
    assert.equal(record.engine, "mock");
    assert.equal(mock.opened, before + 1);
  });

  it("planNodeToEngagementInput forwards per-node engine", () => {
    const input = planNodeToEngagementInput(
      { id: "plan-1", nodes: [] },
      {
        id: "n1",
        agent: { name: "plan-agent", rootDir: FIXTURE_ROOT },
        task: "step",
        engine: "prime",
      },
    );
    assert.equal(input.engine, "prime");
    assert.equal(input.agentName, "plan-agent");
    assert.equal(input.requestId, "plan-1:n1");
  });

  it("bogus serialized engine fails the leaf fast with ENGINE_UNKNOWN", async () => {
    if (!workerStarted) {
      await worker.start();
      workerStarted = true;
    }
    const handle = await runtime.dispatch({
      agent: { name: "ow-s2e-bogus", rootDir: FIXTURE_ROOT },
      task: "bogus engine",
      engine: "bogus" as never,
      clientRequestId: "s2e-ow-bogus-1",
    });
    const status = await runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(status.state, "completed", JSON.stringify(status));
    const result = status.result as { kind?: string; error?: { code?: string } };
    assert.equal(result?.kind, "failed");
    assert.equal(result?.error?.code, "ENGINE_UNKNOWN");
  });
});

describe("MockEnginePort resume semantics (S2e)", () => {
  it("openSession honors req.resume for engine-specific sessionRef", async () => {
    const port = new MockEnginePort();
    const handle = await port.openSession({
      resume: asSessionRef("prior-pi-ref"),
      definition: agentDefForPacks("/tmp", []),
      packPlan: { packs: [], diagnostics: [], ok: true },
      cwd: "/tmp",
      settings: { inMemory: true },
      tools: {},
    });
    assert.equal(handle.sessionRef, "prior-pi-ref");
    await handle.dispose();
  });
});
