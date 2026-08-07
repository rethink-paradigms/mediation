/**
 * Unit of PrimeEngineAdapter — thin fake Prime session surface (not mock EnginePort).
 * Mirrors test/pi/engine-adapter.test.ts with fork event deltas (no agent_settled;
 * idle via waitForIdle; agent_end → raw unless mapAgentEndAsIdle).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { PrimeEngineAdapter } from "../../src/adapters/prime/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import type { OpenSessionRequest } from "../../src/ports/engine.ts";
import { FakePrimeSession } from "./fake-session.ts";
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

describe("PrimeEngineAdapter (fake Prime session)", () => {
  it("openSession → sessionRef from sessionFile or sessionId", async () => {
    const fake = new FakePrimeSession({
      sessionId: "psid-1",
      sessionFile: "/tmp/prime-session-1.jsonl",
    });
    const engine = new PrimeEngineAdapter({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionFile ?? fake.sessionId,
      }),
    });

    const handle = await engine.openSession(minimalRequest());
    assert.equal(handle.sessionRef, "/tmp/prime-session-1.jsonl");
    assert.equal(engine.opened.length, 1);

    const idle = await handle.waitUntilIdle();
    assert.equal(idle.reason, "session_open");
    await handle.dispose();
  });

  it("prompt → idle via waitForIdle (no agent_settled on fork)", async () => {
    const fake = new FakePrimeSession({ sessionId: "psid-prompt" });
    const engine = new PrimeEngineAdapter({
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

    await handle.prompt("hello prime unit");
    assert.deepEqual(fake.promptCalls, ["hello prime unit"]);

    const idle = await handle.waitUntilIdle();
    assert.equal(idle.reason, "waitForIdle");
    assert.ok(
      seen.some((s) => s.startsWith("idle:")),
      `expected idle in trail: ${seen.join(",")}`,
    );
    assert.ok(fake.waitForIdleCallCount >= 1);

    await handle.dispose();
  });

  it("mapAgentEndAsIdle → agent_end emits idle for observers", async () => {
    // The adapter does not expose mapAgentEndAsIdle — exercise the handle
    // directly (same construction path engine-adapter uses).
    const { PrimeEngineSessionHandle } = await import(
      "../../src/adapters/prime/session-handle.ts"
    );
    const { asSessionRef } = await import("../../src/domain/presence.ts");
    const fake = new FakePrimeSession({ sessionId: "psid-map" });
    const engine = new PrimeEngineAdapter({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionId,
      }),
    });
    const handle = await engine.openSession(minimalRequest());
    const mapped = new PrimeEngineSessionHandle({
      session: fake,
      sessionRef: asSessionRef(fake.sessionId),
      mapAgentEndAsIdle: true,
    });
    const seen: string[] = [];
    mapped.subscribe((e) => {
      seen.push(e.type === "idle" ? `idle:${e.snapshot.reason}` : e.type);
    });
    await mapped.prompt("map me");
    const idle = await mapped.waitUntilIdle();
    assert.ok(
      idle.reason === "agent_end" || idle.reason === "waitForIdle",
      `got ${idle.reason}`,
    );
    assert.ok(
      seen.some((s) => s === "idle:agent_end"),
      `expected idle:agent_end in trail: ${seen.join(",")}`,
    );
    await mapped.dispose();
    await handle.dispose();
  });

  it("continue uses agent.continue when present", async () => {
    const fake = new FakePrimeSession({
      sessionId: "psid-cont",
      withAgentContinue: true,
    });
    const engine = new PrimeEngineAdapter({
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

  it("interrupt steer / followUp / abort map to Prime surface", async () => {
    const fake = new FakePrimeSession({ sessionId: "psid-int" });
    const engine = new PrimeEngineAdapter({
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

  it("factory materialize + engage Settled with PrimeEngineAdapter (fake)", async () => {
    const fake = new FakePrimeSession({
      sessionId: "psid-factory",
      sessionFile: "fake-prime-session-s2b",
    });
    const engine = new PrimeEngineAdapter({
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
    assert.equal(presence.sessionRef, "fake-prime-session-s2b");

    const outcome = await presence.engage({ text: "hello prime adapter" });
    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, "fake-prime-session-s2b");
    }
    assert.deepEqual(fake.promptCalls, ["hello prime adapter"]);

    await presence.dispose();
    assert.equal(presence.status, "disposed");
  });

  it("waitUntilIdle respects AbortSignal", async () => {
    const fake = new FakePrimeSession({
      sessionId: "psid-abort-wait",
      settleDelayMs: 5000,
    });
    const engine = new PrimeEngineAdapter({
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
