/**
 * SURFACES (issue #3) — Interrupt recipe (F) + live-Presence registry.
 *
 * Scenario (b): interrupt a live run by runId steers it; interrupt a non-live
 * run → PRESENCE_NOT_LIVE (MediationError). Registry is in-process only
 * (LIFE-L1 first pour; multi-process bus deferred).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { interrupt as interruptRecipe } from "../../src/app/recipes/interrupt.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { InProcessNotifier } from "../../src/adapters/notify/in-process.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";
import { MediationError } from "../../src/domain/errors.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import type { PackSnapshot } from "../../src/domain/packs.ts";
import type {
  AgentPresence,
  InterruptKind,
  PresenceStatus,
} from "../../src/domain/presence.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type { NotifyRecord } from "../../src/ports/notify.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function makeMediation(
  notify?: InProcessNotifier,
): Mediation {
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

function makeSpyPresence(): {
  readonly presence: AgentPresence;
  readonly calls: { readonly kind: InterruptKind; readonly payload?: unknown }[];
} {
  const calls: { kind: InterruptKind; payload?: unknown }[] = [];
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
  const presence = {
    id: "spy-presence",
    definition,
    sessionRef: asSessionRef("spy-sess"),
    packSnapshot,
    status: "engaging" as PresenceStatus,
    engage: async () => ({
      kind: "settled" as const,
      sessionRef: asSessionRef("spy-sess"),
    }),
    interrupt: async (kind: InterruptKind, payload?: unknown) => {
      calls.push({ kind, payload });
    },
    attach: async () => {},
    detach: async () => {},
    observe: () => () => {},
    dispose: async () => {},
  } satisfies AgentPresence;
  return { presence, calls };
}

describe("Interrupt (recipe F / LIFE-L1 live registry)", () => {
  it("scenario (b): interrupt a registered live run by runId steers it + notifies interrupted", async () => {
    const notifier = new InProcessNotifier();
    const records: NotifyRecord[] = [];
    notifier.on((r) => { records.push(r); });
    const mediation = makeMediation(notifier);
    const { presence, calls } = makeSpyPresence();
    const runId = asRunId("live-run-1");

    mediation.registerLivePresence(runId, presence);
    await mediation.interrupt(runId, "steer", { note: "redirect" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.kind, "steer");
    assert.deepEqual(calls[0]!.payload, { note: "redirect" });
    assert.ok(
      records.some((r) => r.event === "interrupted" && r.runId === runId),
      "interrupted notify fired",
    );

    mediation.unregisterLivePresence(runId);
  });

  it("scenario (b): interrupt a non-live run → PRESENCE_NOT_LIVE", async () => {
    const mediation = makeMediation();
    await assert.rejects(
      () => mediation.interrupt(asRunId("never-live"), "abort"),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "PRESENCE_NOT_LIVE");
        return true;
      },
    );
  });

  it("after unregister, the same runId is PRESENCE_NOT_LIVE", async () => {
    const mediation = makeMediation();
    const { presence } = makeSpyPresence();
    const runId = asRunId("live-run-2");
    mediation.registerLivePresence(runId, presence);
    mediation.unregisterLivePresence(runId);
    await assert.rejects(
      () => mediation.interrupt(runId, "followUp", { q: "?" }),
      (err: unknown) =>
        err instanceof MediationError && err.code === "PRESENCE_NOT_LIVE",
    );
  });

  it("interrupt recipe delegates to Mediation.interrupt and surfaces PRESENCE_NOT_LIVE", async () => {
    const mediation = makeMediation();
    const { presence, calls } = makeSpyPresence();
    const runId = asRunId("live-run-3");
    mediation.registerLivePresence(runId, presence);

    await interruptRecipe.run({ mediation }, { runId, kind: "followUp", payload: { q: "?" } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.kind, "followUp");

    await assert.rejects(
      () =>
        interruptRecipe.run(
          { mediation },
          { runId: asRunId("dead-run"), kind: "abort" },
        ),
      (err: unknown) =>
        err instanceof MediationError && err.code === "PRESENCE_NOT_LIVE",
    );
    mediation.unregisterLivePresence(runId);
  });
});
