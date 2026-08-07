/**
 * SURFACES (issue #3) — Observe recipe (G) + MediationEvent emission.
 *
 * Scenario (d): observe stream ordering park → wake → settled for one run.
 * Plus: façade ops (dispatch / wake / engageLocal) emit MediationEvent.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { observe } from "../../src/app/recipes/observe.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { InProcessNotifier } from "../../src/adapters/notify/in-process.ts";
import { createSqliteRuntimeHost } from "../../src/adapters/openworkflow/host.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import type { MediationEvent } from "../../src/domain/events.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type {
  DispatchHandle,
  DispatchInput,
  RuntimePort,
  RuntimeStatus,
} from "../../src/ports/runtime.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

type Hosted = {
  readonly mediation: Mediation;
  readonly host: ReturnType<typeof createSqliteRuntimeHost>;
};

function makeHosted(): Hosted {
  const notifier = new InProcessNotifier();
  const loader = {
    load: async (ref: { name: string; rootDir: string }) =>
      agentDefForPacks(ref.rootDir, ["foo", "bar"], ref.name),
  };
  const factory = new DefaultPresenceFactory({
    engine: new MockEnginePort(),
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({ projectRoot: FIXTURE_ROOT, homeDir: NO_HOME }),
    ),
    defaultEngine: "mock",
  });
  const join = new MemoryJoinStore();
  const host = createSqliteRuntimeHost({
    dbPath: ":memory:",
    factory,
    join,
    resolveDefinition: (inp) =>
      agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
    pollIntervalMs: 15,
    concurrency: 2,
    notify: notifier,
    defaultEngine: "mock",
  });
  const mediation = new Mediation({
    loader,
    factory,
    join: host.join,
    runtime: host.runtime,
    notify: notifier,
  });
  return { mediation, host };
}

function makeMockRuntime(): RuntimePort {
  const statuses = new Map<string, RuntimeStatus>();
  return {
    async dispatch(input: DispatchInput): Promise<DispatchHandle> {
      const runId = asRunId(input.clientRequestId ?? "mock-run");
      statuses.set(runId, { state: "running", parked: true });
      return { runId };
    },
    async runPlan(): Promise<DispatchHandle> {
      return { runId: asRunId("mock-plan") };
    },
    async sendSignal(): Promise<void> {},
    async cancel(): Promise<void> {},
    async getStatus(runId) {
      return statuses.get(runId) ?? { state: "pending" };
    },
    async wait(runId) {
      return statuses.get(runId) ?? { state: "pending" };
    },
  };
}

function makeLocalMediationWithRuntime(runtime: RuntimePort): Mediation {
  const factory = new DefaultPresenceFactory({
    engine: new MockEnginePort({
      sessionRefFactory: () => asSessionRef("observe-sess"),
    }),
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({ projectRoot: FIXTURE_ROOT, homeDir: NO_HOME }),
    ),
    defaultEngine: "mock",
  });
  const loader = {
    load: async (ref: { name: string; rootDir: string }) =>
      agentDefForPacks(ref.rootDir, ["foo", "bar"], ref.name),
  };
  return new Mediation({ loader, factory, runtime });
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => { setTimeout(r, 20); });
  }
  throw new Error("timeout in waitFor");
}

function runIdOf(e: MediationEvent): unknown {
  return "runId" in e ? (e as { readonly runId?: unknown }).runId : undefined;
}

describe("Observe (recipe G) — MediationEvent emission", () => {
  it("scenario (d): observe stream ordering park → wake → settled (one run)", async () => {
    const { mediation, host } = makeHosted();
    const events: MediationEvent[] = [];
    const unsub = mediation.observe((e) => { events.push(e); });
    try {
      await host.worker.start();
      const handle = await mediation.dispatch({
        agent: { name: "obs-park", rootDir: FIXTURE_ROOT },
        task: "park",
        parkIntent: true,
        parkReason: "observe-test",
        clientRequestId: "obs-d",
      });

      await waitFor(() =>
        events.some((e) => e.type === "run.parked" && runIdOf(e) === handle.runId),
      );
      await mediation.wake(handle.runId, { payloadText: "go" });
      await waitFor(() =>
        events.some((e) => e.type === "run.settled" && runIdOf(e) === handle.runId),
      );

      const scoped = events.filter((e) => runIdOf(e) === handle.runId);
      const kinds = scoped.map((e) => e.type);
      const parkIdx = kinds.indexOf("run.parked");
      const wakeIdx = kinds.indexOf("run.wake");
      const settledIdx = kinds.indexOf("run.settled");
      assert.ok(parkIdx >= 0, "run.parked emitted");
      assert.ok(wakeIdx >= 0, "run.wake emitted");
      assert.ok(settledIdx >= 0, "run.settled emitted");
      assert.ok(
        parkIdx < wakeIdx && wakeIdx < settledIdx,
        `ordering park→wake→settled, got ${kinds.join(" → ")}`,
      );
    } finally {
      unsub();
      await host.stop();
    }
  });

  it("façade ops emit MediationEvent: dispatch materializing, wake run.wake, engageLocal presence.outcome", async () => {
    const runtime = makeMockRuntime();
    const mediation = makeLocalMediationWithRuntime(runtime);
    const events: MediationEvent[] = [];
    const unsub = mediation.observe((e) => { events.push(e); });
    try {
      const handle = await mediation.dispatch({
        agent: { name: "obs-facade", rootDir: FIXTURE_ROOT },
        task: "durable",
        clientRequestId: "obs-facade-1",
      });
      const dispatched = events.find(
        (e) => e.type === "engagement.status" && runIdOf(e) === handle.runId,
      );
      assert.ok(dispatched, "dispatch emitted engagement.status");
      assert.equal(
        (dispatched as { readonly status?: string }).status,
        "materializing",
      );

      await mediation.wake(handle.runId, { payloadText: "wake now" });
      const wakeEvent = events.find(
        (e) => e.type === "run.wake" && runIdOf(e) === handle.runId,
      );
      assert.ok(wakeEvent, "wake emitted run.wake");
      assert.equal(
        (wakeEvent as { readonly payloadText?: string }).payloadText,
        "wake now",
      );

      const local = await mediation.engageLocal({
        agent: { name: "obs-local", rootDir: FIXTURE_ROOT },
        task: "local turn",
      });
      assert.equal(local.outcome.kind, "settled");
      const outcomeEvent = events.find((e) => e.type === "presence.outcome");
      assert.ok(outcomeEvent, "engageLocal emitted presence.outcome");
    } finally {
      unsub();
    }
  });

  it("observe recipe filters the stream by runId", async () => {
    const runtime = makeMockRuntime();
    const mediation = makeLocalMediationWithRuntime(runtime);
    const recipe = await observe.run({ mediation }, { runId: "obs-filter-1" });
    const seen: MediationEvent[] = [];
    const unsub = recipe.subscribe((e) => { seen.push(e); });
    try {
      const handle = await mediation.dispatch({
        agent: { name: "obs-filter", rootDir: FIXTURE_ROOT },
        task: "x",
        clientRequestId: "obs-filter-1",
      });
      assert.equal(handle.runId, "obs-filter-1");
      assert.equal(seen.length, 1);
      assert.equal(seen[0]!.type, "engagement.status");
      assert.equal(runIdOf(seen[0]!), "obs-filter-1");

      // Local engage events (no runId) must be filtered out by the recipe.
      await mediation.engageLocal({
        agent: { name: "obs-filter", rootDir: FIXTURE_ROOT },
        task: "local",
      });
      assert.equal(seen.length, 1, "non-run events filtered by runId scope");
    } finally {
      unsub();
    }
  });
});
