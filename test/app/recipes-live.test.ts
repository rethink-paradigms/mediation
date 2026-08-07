/**
 * SURFACES (issue #3) — Live recipe (D) — multi-engage same presence.
 *
 * Scenario (c): two sequential engages on the same sessionRef without
 * re-materialize; runId registration makes the live presence interruptible.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { live } from "../../src/app/recipes/live.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { InProcessNotifier } from "../../src/adapters/notify/in-process.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type { NotifyRecord } from "../../src/ports/notify.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function makeMediation(
  engine: MockEnginePort,
  notify?: InProcessNotifier,
): Mediation {
  const factory = new DefaultPresenceFactory({
    engine,
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

describe("Live recipe (D) — multi-engage same presence", () => {
  it("scenario (c): two sequential engages, same sessionRef, materialized once", async () => {
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("live-sess"),
    });
    const mediation = makeMediation(engine);
    const agent = { name: "live-agent", rootDir: FIXTURE_ROOT };

    const result = await live.run(
      { mediation },
      {
        agent,
        turns: [
          { text: "first turn" },
          { text: "second turn", mode: "continue" },
        ],
      },
    );

    assert.equal(result.outcomes.length, 2);
    assert.equal(result.outcomes[0]!.kind, "settled");
    assert.equal(result.outcomes[1]!.kind, "settled");
    assert.equal(result.sessionRef, "live-sess");
    assert.equal(engine.opened.length, 1, "materialize exactly once");
    assert.ok(result.presenceId.length > 0);
  });

  it("live with runId + keepAlive registers the presence for interrupt; close() releases", async () => {
    const notifier = new InProcessNotifier();
    const records: NotifyRecord[] = [];
    notifier.on((r) => { records.push(r); });
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("live-keep-sess"),
    });
    const mediation = makeMediation(engine, notifier);
    const runId = asRunId("live-run-k1");

    const result = await live.run(
      { mediation },
      {
        agent: { name: "live-keep", rootDir: FIXTURE_ROOT },
        runId,
        keepAlive: true,
        turns: [{ text: "hello" }],
      },
    );
    assert.ok(result.presence, "keepAlive returns the live presence");
    assert.equal(result.outcomes[0]!.kind, "settled");

    // While kept alive, interrupt by runId steers the live presence.
    await mediation.interrupt(runId, "steer", { note: "redirect" });
    assert.ok(
      records.some((r) => r.event === "interrupted" && r.runId === runId),
      "interrupted notify fired for live run",
    );

    // close() unregisters + disposes; interrupt afterwards is PRESENCE_NOT_LIVE.
    assert.ok(result.close, "keepAlive result exposes close()");
    await result.close!();
    await assert.rejects(
      () => mediation.interrupt(runId, "abort"),
      (err: unknown) =>
        err instanceof Error &&
        "code" in err &&
        err.code === "PRESENCE_NOT_LIVE",
    );
  });

  it("live without keepAlive disposes after last turn (not interruptible after run)", async () => {
    const mediation = makeMediation(new MockEnginePort());
    const runId = asRunId("live-run-k2");
    const result = await live.run(
      { mediation },
      {
        agent: { name: "live-once", rootDir: FIXTURE_ROOT },
        runId,
        turns: [{ text: "only turn" }],
      },
    );
    assert.equal(result.presence, undefined);
    assert.equal(result.outcomes[0]!.kind, "settled");
    await assert.rejects(
      () => mediation.interrupt(runId, "abort"),
      (err: unknown) =>
        err instanceof Error &&
        "code" in err &&
        err.code === "PRESENCE_NOT_LIVE",
    );
  });
});
