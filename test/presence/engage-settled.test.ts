/**
 * S2: materialize + engage → Settled (mock EnginePort).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import {
  PackResolverImpl,
  agentDefForPacks,
} from "../../src/adapters/packs/resolve-packs.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { evaluateSettled, maySettle } from "../../src/app/settled-policy.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { MediationError } from "../../src/domain/errors.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

function makeFactory(engine: MockEnginePort): DefaultPresenceFactory {
  return new DefaultPresenceFactory({
    engine,
    packResolver: new PackResolverImpl({
      homeDir: path.join(FIXTURE_ROOT, "_no_home"),
    }),
    toPackSnapshot,
    projectRoot: FIXTURE_ROOT,
  });
}

describe("settled-policy", () => {
  it("idle + no park → allow Settled", () => {
    const decision = evaluateSettled({
      idle: { at: "2026-01-01T00:00:00.000Z" },
      parkIntent: false,
    });
    assert.equal(decision.allow, true);
    assert.equal(
      maySettle({ at: "2026-01-01T00:00:00.000Z" }, false),
      true,
    );
  });

  it("park intent → deny Settled", () => {
    const decision = evaluateSettled({
      idle: { at: "2026-01-01T00:00:00.000Z" },
      parkIntent: true,
    });
    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.reason, "park_intent");
    }
  });
});

describe("materialize + engage → Settled (mock engine)", () => {
  it("factory materialize then engage returns settled with sessionRef", async () => {
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("mock-session-s2"),
    });
    const factory = makeFactory(engine);

    const definition = agentDefForPacks(FIXTURE_ROOT, ["foo", "bar"], "case-basic");

    const presence = await factory.materialize(definition);
    assert.equal(presence.status, "idle");
    assert.equal(presence.sessionRef, "mock-session-s2");
    assert.equal(presence.packSnapshot.packs.length, 2);
    assert.equal(typeof presence.packSnapshot.planHash, "string");
    assert.equal(presence.packSnapshot.planHash.length, 64);

    const statuses: string[] = [presence.status];
    const unsub = presence.observe((e) => {
      if (e.type === "status") statuses.push(e.status);
    });

    const outcome = await presence.engage({ text: "hello pilot" });

    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, "mock-session-s2");
    }
    assert.equal(presence.status, "idle");
    assert.ok(
      statuses.includes("engaging"),
      `expected engaging in status trail, got ${statuses.join(",")}`,
    );
    assert.ok(
      statuses.filter((s) => s === "idle").length >= 1,
      "expected return to idle",
    );

    unsub();
    await presence.dispose();
    assert.equal(presence.status, "disposed");
  });

  it("materialize resume reuses sessionRef", async () => {
    const engine = new MockEnginePort();
    const factory = makeFactory(engine);
    const definition = agentDefForPacks(FIXTURE_ROOT, ["foo"], "resume-agent");
    const resume = asSessionRef("prior-session-1");
    const presence = await factory.materialize(definition, { resume });
    assert.equal(presence.sessionRef, resume);
    const outcome = await presence.engage({
      text: "continue work",
      mode: "continue",
    });
    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, resume);
    }
    await presence.dispose();
  });

  it("fail-closed: missing pack prevents materialize", async () => {
    const engine = new MockEnginePort();
    const factory = makeFactory(engine);
    const definition = agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "nope"],
      "bad-packs",
    );

    await assert.rejects(
      () => factory.materialize(definition),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "PACK_RESOLVE_FAILED");
        return true;
      },
    );
    assert.equal(engine.opened.length, 0);
  });
});
