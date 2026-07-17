/**
 * S3: Resume fidelity — same sessionRef + stable packSnapshot across rematerialize.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../../src/adapters/packs/resolve-packs.ts";
import { createPiPresenceFactory } from "../../src/adapters/wiring.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { FakePiSession } from "../pi/fake-session.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

describe("resume fidelity (S3, mock engine)", () => {
  it("rematerialize resume → same sessionRef + equal packSnapshot.planHash", async () => {
    const engine = new MockEnginePort();
    const factory = new DefaultPresenceFactory({
      engine,
      toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: NO_HOME,
      }),
    ),
    });
    const definition = agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "bar"],
      "resume-s3-mock",
    );

    const first = await factory.materialize(definition);
    const sessionRef = first.sessionRef;
    const planHash = first.packSnapshot.planHash;
    assert.ok(sessionRef);
    assert.equal(planHash.length, 64);

    const outcome1 = await first.engage({ text: "first turn" });
    assert.equal(outcome1.kind, "settled");
    await first.dispose();

    const second = await factory.materialize(definition, {
      resume: sessionRef,
    });
    assert.equal(second.sessionRef, sessionRef);
    assert.equal(second.packSnapshot.planHash, planHash);
    // pack set identity: same pack ids
    assert.deepEqual(
      [...second.packSnapshot.packs.map((p) => p.id)].sort(),
      [...first.packSnapshot.packs.map((p) => p.id)].sort(),
    );

    const outcome2 = await second.engage({
      text: "second turn",
      mode: "continue",
    });
    assert.equal(outcome2.kind, "settled");
    if (outcome2.kind === "settled") {
      assert.equal(outcome2.sessionRef, sessionRef);
    }
    await second.dispose();

    assert.equal(engine.opened.length, 2);
  });

  it("join can supply sessionRef for rematerialize", async () => {
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("join-seeded-session"),
    });
    const factory = new DefaultPresenceFactory({
      engine,
      toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: NO_HOME,
      }),
    ),
    });
    const join = new MemoryJoinStore();
    const definition = agentDefForPacks(FIXTURE_ROOT, ["foo"], "join-resume");

    const first = await factory.materialize(definition);
    await join.put({
      runId: asRunId("run-s3-join"),
      sessionRef: first.sessionRef,
      definitionId: definition.id,
      packSnapshot: first.packSnapshot,
      status: "settled",
      updatedAt: new Date().toISOString(),
    });
    await first.dispose();

    const record = await join.getByRunId(asRunId("run-s3-join"));
    assert.ok(record);

    const resumed = await factory.materialize(definition, {
      resume: record.sessionRef,
    });
    assert.equal(resumed.sessionRef, record.sessionRef);
    assert.equal(resumed.packSnapshot.planHash, record.packSnapshot.planHash);
    await resumed.dispose();
  });
});

describe("resume fidelity (S3, Pi factory fake session)", () => {
  it("createPiPresenceFactory resume keeps sessionRef + planHash", async () => {
    const factoryResume = asSessionRef("prior-pi-s3");
    let openCount = 0;
    const { factory } = createPiPresenceFactory({
      sessionFactory: async (req) => {
        openCount += 1;
        const ref = req.resume
          ? String(req.resume)
          : `fresh-pi-s3-${openCount}`;
        const fake = new FakePiSession({
          sessionId: `sid-${openCount}`,
          sessionFile: ref,
        });
        return { session: fake, sessionRefValue: ref };
      },
      fsStoreOptions: { homeDir: NO_HOME },
      projectRoot: FIXTURE_ROOT,
    });

    const definition = agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "bar"],
      "resume-s3-pi",
    );

    const cold = await factory.materialize(definition);
    // force known ref for clean resume proof
    await cold.dispose();

    const first = await factory.materialize(definition, {
      resume: factoryResume,
    });
    assert.equal(first.sessionRef, factoryResume);
    const hash = first.packSnapshot.planHash;
    await first.engage({ text: "turn a" });
    await first.dispose();

    const second = await factory.materialize(definition, {
      resume: factoryResume,
    });
    assert.equal(second.sessionRef, factoryResume);
    assert.equal(second.packSnapshot.planHash, hash);
    const out = await second.engage({ text: "turn b", mode: "continue" });
    assert.equal(out.kind, "settled");
    await second.dispose();
  });
});
