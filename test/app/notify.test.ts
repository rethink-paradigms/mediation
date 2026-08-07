/**
 * SURFACES (issue #3) — NotifyPort scenarios (D3 P4 first pour).
 *
 * Scenario suite authored from intent before implementation (TESTING-DOCTRINE):
 *  (a) dispatched run parks → notify delivered → wake → settled notify on same run.
 *  notify fires on park / settle / fail; listener errors are isolated.
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
import { asSessionRef } from "../../src/domain/presence.ts";
import type { NotifyPort, NotifyRecord } from "../../src/ports/notify.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function makeLocalMediation(notify?: NotifyPort): Mediation {
  const factory = new DefaultPresenceFactory({
    engine: new MockEnginePort({
      sessionRefFactory: () => asSessionRef("local-notify-sess"),
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
  return new Mediation({ loader, factory, notify });
}

type Hosted = {
  readonly notifier: InProcessNotifier;
  readonly records: NotifyRecord[];
  readonly mediation: Mediation;
  readonly host: ReturnType<typeof createSqliteRuntimeHost>;
};

function makeHosted(opts?: { readonly badPacks?: boolean }): Hosted {
  const notifier = new InProcessNotifier();
  const records: NotifyRecord[] = [];
  notifier.on((r) => { records.push(r); });

  const packs = opts?.badPacks === true ? ["foo", "missing"] : ["foo", "bar"];
  const loader = {
    load: async (ref: { name: string; rootDir: string }) =>
      agentDefForPacks(ref.rootDir, packs, ref.name),
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
      agentDefForPacks(inp.agentRoot, packs, inp.agentName),
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
  return { notifier, records, mediation, host };
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

describe("NotifyPort (D3 P4 first pour)", () => {
  it("scenario (a): dispatched park → notify parked → wake → notify settled (same run)", async () => {
    const hosted = makeHosted();
    const { mediation, host, records } = hosted;
    try {
      await host.worker.start();
      const handle = await mediation.dispatch({
        agent: { name: "notify-park", rootDir: FIXTURE_ROOT },
        task: "park me",
        parkIntent: true,
        parkReason: "notify-test",
        clientRequestId: "nt-a",
      });

      await waitFor(() => records.some((r) => r.event === "parked"));
      const parked = records.find((r) => r.event === "parked")!;
      assert.equal(parked.runId, handle.runId);
      assert.ok(parked.sessionRef, "parked record carries sessionRef");
      assert.equal(
        (parked.payload as { reason?: string } | undefined)?.reason,
        "notify-test",
      );

      await mediation.wake(handle.runId, { payloadText: "continue now" });

      await waitFor(() => records.some((r) => r.event === "settled"));
      const settled = records.find((r) => r.event === "settled")!;
      assert.equal(settled.runId, handle.runId);
      assert.equal(settled.sessionRef, parked.sessionRef);
    } finally {
      await host.stop();
    }
  });

  it("failed leaf notifies failed", async () => {
    const hosted = makeHosted({ badPacks: true });
    const { mediation, host, records } = hosted;
    try {
      await host.worker.start();
      const handle = await mediation.dispatch({
        agent: { name: "notify-fail", rootDir: FIXTURE_ROOT },
        task: "boom",
        clientRequestId: "nt-fail",
      });
      await waitFor(() => records.some((r) => r.event === "failed"));
      const failed = records.find((r) => r.event === "failed")!;
      assert.equal(failed.runId, handle.runId);
      assert.ok(
        (failed.payload as { error?: { code?: string } } | undefined)?.error,
        "failed record carries error payload",
      );
    } finally {
      await host.stop();
    }
  });

  it("listener errors are isolated: notify resolves, other listeners still receive", async () => {
    const notifier = new InProcessNotifier();
    const received: NotifyRecord[] = [];
    notifier.on(() => {
      throw new Error("listener boom");
    });
    notifier.on((r) => { received.push(r); });

    await notifier.notify({
      runId: asRunId("nt-iso"),
      sessionRef: asSessionRef("iso-sess"),
      event: "parked",
      payload: { reason: "x" },
    });

    assert.equal(received.length, 1);
    assert.equal(received[0]!.event, "parked");
  });

  it("local façade (engageLocal) notifies parked then settled", async () => {
    const notifier = new InProcessNotifier();
    const records: NotifyRecord[] = [];
    notifier.on((r) => { records.push(r); });
    const mediation = makeLocalMediation(notifier);

    const parked = await mediation.engageLocal({
      agent: { name: "local-notify", rootDir: FIXTURE_ROOT },
      task: "park",
      parkIntent: true,
    });
    assert.equal(parked.outcome.kind, "parked");
    assert.ok(records.some((r) => r.event === "parked"), "parked notify fired");
    assert.ok(
      records.some((r) => r.event === "parked" && r.sessionRef !== undefined),
      "local parked record carries sessionRef",
    );

    const settled = await mediation.engageLocal({
      agent: { name: "local-notify", rootDir: FIXTURE_ROOT },
      task: "settle now",
    });
    assert.equal(settled.outcome.kind, "settled");
    assert.ok(records.some((r) => r.event === "settled"), "settled notify fired");
  });
});
