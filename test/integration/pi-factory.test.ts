/**
 * S2c: createPiPresenceFactory + materialize + engage → Settled (fake Pi).
 * Default check path — no live keys required.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { agentDefForPacks } from "../helpers/agent-def.ts";
import { createPiPresenceFactory } from "../../src/adapters/wiring.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { MediationError } from "../../src/domain/errors.ts";
import { FakePiSession } from "../pi/fake-session.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

describe("createPiPresenceFactory (integration, fake Pi)", () => {
  it("materialize + engage → Settled with sessionRef", async () => {
    const fake = new FakePiSession({
      sessionId: "sid-s2c",
      sessionFile: "fake-session-s2c",
    });
    const { factory, engine } = createPiPresenceFactory({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionFile ?? fake.sessionId,
      }),
      fsStoreOptions: { homeDir: NO_HOME },
      projectRoot: FIXTURE_ROOT,
    });

    const definition = agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "bar"],
      "case-basic-s2c",
    );
    const presence = await factory.materialize(definition);

    assert.equal(presence.status, "idle");
    assert.equal(presence.sessionRef, "fake-session-s2c");
    assert.equal(engine.opened.length, 1);
    assert.equal(presence.packSnapshot.packs.length, 2);

    const statuses: string[] = [presence.status];
    const unsub = presence.observe((e) => {
      if (e.type === "status") statuses.push(e.status);
    });

    const outcome = await presence.engage({ text: "hello s2c factory" });
    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, "fake-session-s2c");
    }
    assert.equal(presence.status, "idle");
    assert.ok(statuses.includes("engaging"));
    assert.deepEqual(fake.promptCalls, ["hello s2c factory"]);

    unsub();
    await presence.dispose();
    assert.equal(presence.status, "disposed");
  });

  it("materialize resume reuses sessionRef via composition helper", async () => {
    const resume = asSessionRef("prior-session-s2c");
    const fake = new FakePiSession({
      sessionId: "sid-resume",
      sessionFile: String(resume),
    });
    const { factory } = createPiPresenceFactory({
      sessionFactory: async (req) => {
        const ref = req.resume ? String(req.resume) : fake.sessionId;
        return { session: fake, sessionRefValue: ref };
      },
      fsStoreOptions: { homeDir: NO_HOME },
      projectRoot: FIXTURE_ROOT,
    });

    const definition = agentDefForPacks(FIXTURE_ROOT, ["foo"], "resume-s2c");
    const presence = await factory.materialize(definition, { resume });
    assert.equal(presence.sessionRef, resume);

    const outcome = await presence.engage({
      text: "continue",
      mode: "continue",
    });
    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, resume);
    }
    await presence.dispose();
  });

  it("fail-closed: missing pack prevents materialize (no openSession)", async () => {
    const fake = new FakePiSession({ sessionId: "never-opened" });
    const { factory, engine } = createPiPresenceFactory({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionId,
      }),
      fsStoreOptions: { homeDir: NO_HOME },
      projectRoot: FIXTURE_ROOT,
    });

    const definition = agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "nope"],
      "bad-packs-s2c",
    );

    await assert.rejects(
      () => factory.materialize(definition),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "CAPABILITY_RESOLVE_FAILED");
        return true;
      },
    );
    assert.equal(engine.opened.length, 0);
  });
});
