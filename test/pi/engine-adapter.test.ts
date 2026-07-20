/**
 * Unit of PiEngineAdapter — thin fake Pi session surface (not mock EnginePort).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { PiEngineAdapter } from "../../src/adapters/pi/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import type { OpenSessionRequest } from "../../src/ports/engine.ts";
import { FakePiSession } from "./fake-session.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import { packLoadPlanFromFsSpecs } from "../helpers/fs-pack-plan.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function minimalRequest(
  overrides: Partial<OpenSessionRequest> = {},
): OpenSessionRequest {
  const definition = agentDefForPacks(FIXTURE_ROOT, ["foo"], "case-basic");
  const plan = packLoadPlanFromFsSpecs(
    definition.extensions ?? [],
    FIXTURE_ROOT,
    NO_HOME,
  );
  return {
    definition,
    packPlan: plan,
    cwd: FIXTURE_ROOT,
    settings: { inMemory: true, thinking: "off" },
    tools: { agentMode: "static" },
    ...overrides,
  };
}

describe("PiEngineAdapter (fake Pi session)", () => {
  it("openSession → sessionRef from sessionFile or sessionId", async () => {
    const fake = new FakePiSession({
      sessionId: "sid-1",
      sessionFile: "/tmp/pi-session-1.jsonl",
    });
    const engine = new PiEngineAdapter({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionFile ?? fake.sessionId,
      }),
    });

    const handle = await engine.openSession(minimalRequest());
    assert.equal(handle.sessionRef, "/tmp/pi-session-1.jsonl");
    assert.equal(engine.opened.length, 1);

    const idle = await handle.waitUntilIdle();
    assert.equal(idle.reason, "session_open");
    await handle.dispose();
  });

  it("prompt → agent_settled idle via subscribe + waitUntilIdle", async () => {
    const fake = new FakePiSession({ sessionId: "sid-prompt" });
    const engine = new PiEngineAdapter({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionId,
      }),
    });
    const handle = await engine.openSession(minimalRequest());

    const seen: string[] = [];
    handle.subscribe((e) => {
      seen.push(e.type === "idle" ? `idle:${e.snapshot.reason}` : e.type);
    });

    await handle.prompt("hello unit");
    assert.deepEqual(fake.promptCalls, ["hello unit"]);

    const idle = await handle.waitUntilIdle();
    assert.ok(
      idle.reason === "agent_settled" || idle.reason === "waitForIdle",
      `expected settled idle, got ${idle.reason}`,
    );
    assert.ok(
      seen.some((s) => s.startsWith("idle:")),
      `expected idle in trail: ${seen.join(",")}`,
    );
    assert.ok(fake.waitForIdleCallCount >= 1 || seen.includes("idle:agent_settled"));

    await handle.dispose();
  });

  it("continue uses agent.continue when present", async () => {
    const fake = new FakePiSession({
      sessionId: "sid-cont",
      withAgentContinue: true,
    });
    const engine = new PiEngineAdapter({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionId,
      }),
    });
    const handle = await engine.openSession(minimalRequest());
    await handle.continue();
    assert.equal(fake.continueCalls, 1);
    const idle = await handle.waitUntilIdle();
    assert.ok(idle.at);
    await handle.dispose();
  });

  it("interrupt steer / followUp / abort map to Pi surface", async () => {
    const fake = new FakePiSession({ sessionId: "sid-int" });
    const engine = new PiEngineAdapter({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionId,
      }),
    });
    const handle = await engine.openSession(minimalRequest());

    await handle.interrupt("steer", "nudge");
    assert.deepEqual(fake.steerCalls, ["nudge"]);

    await handle.interrupt("followUp", { text: "later" });
    assert.deepEqual(fake.followUpCalls, ["later"]);

    // Start a turn then abort
    const p = handle.prompt("busy");
    await handle.interrupt("abort");
    await p;
    assert.equal(fake.abortCalls, 1);
    const idle = await handle.waitUntilIdle();
    assert.ok(idle.at);

    await handle.dispose();
  });

  it("factory materialize + engage Settled with PiEngineAdapter (fake)", async () => {
    const fake = new FakePiSession({
      sessionId: "sid-factory",
      sessionFile: "fake-session-s2b",
    });
    const engine = new PiEngineAdapter({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionFile ?? fake.sessionId,
      }),
    });
    const factory = new DefaultPresenceFactory({
      engine,
      toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: path.join(FIXTURE_ROOT, "_no_home"),
      }),
    ),
    });

    const definition = agentDefForPacks(FIXTURE_ROOT, ["foo", "bar"], "case-basic");
    const presence = await factory.materialize(definition);
    assert.equal(presence.status, "idle");
    assert.equal(presence.sessionRef, "fake-session-s2b");

    const outcome = await presence.engage({ text: "hello pi adapter" });
    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, "fake-session-s2b");
    }
    assert.deepEqual(fake.promptCalls, ["hello pi adapter"]);

    await presence.dispose();
    assert.equal(presence.status, "disposed");
  });

  it("waitUntilIdle respects AbortSignal", async () => {
    const fake = new FakePiSession({
      sessionId: "sid-abort-wait",
      settleDelayMs: 5000,
    });
    // Override waitForIdle to hang until settle
    const engine = new PiEngineAdapter({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionId,
      }),
    });
    const handle = await engine.openSession(minimalRequest());
    void handle.prompt("slow");
    const ac = new AbortController();
    const wait = handle.waitUntilIdle({ signal: ac.signal });
    ac.abort();
    await assert.rejects(wait, /aborted/u);
    await handle.dispose();
  });
});
