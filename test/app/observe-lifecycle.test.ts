/**
 * POLISH (issue #5) — Observe lifecycle: MediationEvent end-to-end gaps.
 *
 * The SURFACES wave already proves the happy path — durable run
 * park → wake → settled emits in order — in test/app/observe.test.ts
 * scenario (d) via the notify→event bridge. This file closes the gaps that
 * file leaves open (no duplication):
 *
 *   (a) pure: mediationEventFromNotify maps parked/settled/failed/interrupted
 *       → run.* MediationEvents with payload fields (was untested directly).
 *   (b) integration: a FAILED durable run (missing capability, fail-closed)
 *       emits run.failed (code CAPABILITY_RESOLVE_FAILED) via the notify
 *       bridge, after engagement.status — the failure half of the lifecycle.
 *   (c) integration: runId-scoped interrupt emits run.interrupted + the
 *       interrupted notify record.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { InProcessNotifier } from "../../src/adapters/notify/in-process.ts";
import { createSqliteRuntimeHost } from "../../src/adapters/openworkflow/host.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { mediationEventFromNotify } from "../../src/domain/events.ts";
import type { MediationEvent } from "../../src/domain/events.ts";
import {
  asSessionRef,
  type AgentPresence,
  type InterruptKind,
  type PresenceStatus,
} from "../../src/domain/presence.ts";
import type { NotifyRecord } from "../../src/ports/notify.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";
import type { PackSnapshot } from "../../src/domain/packs.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

type Hosted = {
  readonly mediation: Mediation;
  readonly host: ReturnType<typeof createSqliteRuntimeHost>;
};

/** Hosted mediation whose leaf resolves a MISSING capability (fail-closed). */
function makeFailedHosted(): Hosted {
  const notifier = new InProcessNotifier();
  const packs = ["foo", "missing"] as const;
  const loader = {
    load: async (ref: { name: string; rootDir: string }) =>
      agentDefForPacks(ref.rootDir, [...packs], ref.name),
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
      agentDefForPacks(inp.agentRoot, [...packs], inp.agentName),
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

function makeLocalMediation(notify?: InProcessNotifier): Mediation {
  const factory = new DefaultPresenceFactory({
    engine: new MockEnginePort(),
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
  return new Mediation({ loader, factory, notify });
}

function makeSpyPresence(): AgentPresence {
  const definition = {
    id: "spy",
    name: "spy",
    rootDir: "/tmp",
    model: "test/model",
  } as unknown as AgentDefinition;
  const packSnapshot = {
    planHash: "spy-hash",
    packs: [],
    createdAt: new Date().toISOString(),
  } as PackSnapshot;
  return {
    id: "spy-presence",
    definition,
    sessionRef: asSessionRef("spy-sess"),
    packSnapshot,
    status: "engaging" as PresenceStatus,
    engage: async () => ({
      kind: "settled" as const,
      sessionRef: asSessionRef("spy-sess"),
    }),
    interrupt: async (_kind: InterruptKind, _payload?: unknown) => {},
    attach: async () => {},
    detach: async () => {},
    observe: () => () => {},
    dispose: async () => {},
  } satisfies AgentPresence;
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

describe("observe lifecycle (POLISH) — notify→event mapping + failure/interrupt", () => {
  it("(a) pure: mediationEventFromNotify maps all four record kinds", () => {
    const runId = asRunId("map-1");
    const sess = asSessionRef("map-sess");

    const parked = mediationEventFromNotify({
      runId,
      sessionRef: sess,
      event: "parked",
      payload: { reason: "await_human", resumeToken: "park:map-sess:x" },
    });
    assert.deepEqual(parked, {
      type: "run.parked",
      runId,
      sessionRef: sess,
      reason: "await_human",
    });

    const settled = mediationEventFromNotify({
      runId,
      sessionRef: sess,
      event: "settled",
      payload: { result: "ok" },
    });
    assert.deepEqual(settled, { type: "run.settled", runId, sessionRef: sess });

    const failed = mediationEventFromNotify({
      runId,
      sessionRef: sess,
      event: "failed",
      payload: { error: { code: "CAPABILITY_RESOLVE_FAILED" } },
    });
    assert.deepEqual(failed, {
      type: "run.failed",
      runId,
      sessionRef: sess,
      code: "CAPABILITY_RESOLVE_FAILED",
    });

    const interrupted = mediationEventFromNotify({
      runId,
      event: "interrupted",
      payload: { kind: "abort" },
    });
    assert.deepEqual(interrupted, { type: "run.interrupted", runId });
  });

  it("(b) integration: failed durable run emits run.failed via the notify bridge, ordered after materializing", async () => {
    const { mediation, host } = makeFailedHosted();
    const events: MediationEvent[] = [];
    const unsub = mediation.observe((e) => { events.push(e); });
    try {
      await host.worker.start();
      const handle = await mediation.dispatch({
        agent: { name: "obs-fail", rootDir: FIXTURE_ROOT },
        task: "boom",
        clientRequestId: "obs-fail-1",
      });

      await waitFor(() =>
        events.some((e) => e.type === "run.failed" && runIdOf(e) === handle.runId),
      );

      const scoped = events.filter((e) => runIdOf(e) === handle.runId);
      const kinds = scoped.map((e) => e.type);
      const materializingIdx = kinds.indexOf("engagement.status");
      const failedIdx = kinds.indexOf("run.failed");
      assert.ok(materializingIdx >= 0, "engagement.status emitted");
      assert.ok(failedIdx >= 0, "run.failed emitted");
      assert.ok(
        materializingIdx < failedIdx,
        `ordering status → failed, got ${kinds.join(" → ")}`,
      );
      const failedEvent = scoped.find((e) => e.type === "run.failed") as
        | { readonly code?: string }
        | undefined;
      assert.equal(failedEvent?.code, "CAPABILITY_RESOLVE_FAILED");
    } finally {
      unsub();
      await host.stop();
    }
  });

  it("(c) integration: runId-scoped interrupt emits run.interrupted + interrupted notify", async () => {
    const notifier = new InProcessNotifier();
    const records: NotifyRecord[] = [];
    notifier.on((r) => { records.push(r); });
    const mediation = makeLocalMediation(notifier);
    const events: MediationEvent[] = [];
    const unsub = mediation.observe((e) => { events.push(e); });
    try {
      const runId = asRunId("obs-interrupt-1");
      mediation.registerLivePresence(runId, makeSpyPresence());
      await mediation.interrupt(runId, "abort", { note: "halt" });

      assert.ok(
        events.some((e) => e.type === "run.interrupted" && runIdOf(e) === runId),
        "run.interrupted emitted",
      );
      assert.ok(
        records.some((r) => r.event === "interrupted" && r.runId === runId),
        "interrupted notify fired",
      );
    } finally {
      unsub();
    }
  });
});
