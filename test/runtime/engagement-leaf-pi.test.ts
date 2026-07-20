/**
 * S5b: Gamma engagement leaf + createPiPresenceFactory (fake Pi session).
 * Default check path — no live keys.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { runEngagementLeaf } from "../../src/adapters/openworkflow/workflows/engagement.ts";
import type { EngagementWorkflowInput } from "../../src/adapters/openworkflow/types.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import { createPiPresenceFactory } from "../../src/adapters/wiring.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { FakePiSession } from "../pi/fake-session.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function serializableRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("engagement leaf + Pi factory (S5b, fake session)", () => {
  it("materialize → join → engage → settled via createPiPresenceFactory", async () => {
    const fake = new FakePiSession({
      sessionId: "sid-s5b",
      sessionFile: "fake-session-s5b",
    });
    const { factory, engine } = createPiPresenceFactory({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionFile ?? fake.sessionId,
      }),
      fsStoreOptions: { homeDir: NO_HOME },
      projectRoot: FIXTURE_ROOT,
    });
    const join = new MemoryJoinStore();
    const runId = asRunId("run-s5b-1");

    const input: EngagementWorkflowInput = {
      agentName: "case-basic-s5b",
      agentRoot: FIXTURE_ROOT,
      task: "hello leaf pi",
      requestId: "req-s5b-1",
    };
    const wireInput = serializableRoundTrip(input);

    const output = await runEngagementLeaf(wireInput, {
      factory,
      join,
      runId,
      resolveDefinition: (inp) =>
        agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
    });

    assert.equal(output.kind, "settled");
    if (output.kind === "settled") {
      assert.equal(output.sessionRef, "fake-session-s5b");
      assert.equal(typeof output.packSnapshotHash, "string");
      assert.equal(output.packSnapshotHash.length, 64);
    }

    const record = await join.getByRunId(runId);
    assert.ok(record);
    assert.equal(record.status, "settled");
    assert.equal(record.sessionRef, "fake-session-s5b");
    assert.equal(record.definitionId, "case-basic-s5b");
    assert.equal(
      record.packSnapshot.planHash,
      (output as { packSnapshotHash: string }).packSnapshotHash,
    );

    assert.equal(engine.opened.length, 1);
    assert.deepEqual(fake.promptCalls, ["hello leaf pi"]);
  });

  it("resume sessionRef flows through leaf + Pi factory", async () => {
    const resume = asSessionRef("prior-session-s5b");
    const fake = new FakePiSession({
      sessionId: "sid-resume-s5b",
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
    const join = new MemoryJoinStore();

    const output = await runEngagementLeaf(
      {
        agentName: "resume-s5b",
        agentRoot: FIXTURE_ROOT,
        task: "continue leaf",
        sessionRef: String(resume),
      },
      {
        factory,
        join,
        runId: asRunId("run-s5b-resume"),
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo"], inp.agentName),
      },
    );

    assert.equal(output.kind, "settled");
    if (output.kind === "settled") {
      assert.equal(output.sessionRef, resume);
    }
    const record = await join.getBySessionRef(resume);
    assert.ok(record);
    assert.equal(record.status, "settled");
  });

  it("fail-closed pack resolve → failed; no engine open", async () => {
    const fake = new FakePiSession({ sessionId: "never" });
    const { factory, engine } = createPiPresenceFactory({
      sessionFactory: async () => ({
        session: fake,
        sessionRefValue: fake.sessionId,
      }),
      fsStoreOptions: { homeDir: NO_HOME },
      projectRoot: FIXTURE_ROOT,
    });
    const join = new MemoryJoinStore();

    const output = await runEngagementLeaf(
      {
        agentName: "bad-packs-s5b",
        agentRoot: FIXTURE_ROOT,
        task: "nope",
      },
      {
        factory,
        join,
        runId: asRunId("run-s5b-fail"),
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "missing"], inp.agentName),
      },
    );

    assert.equal(output.kind, "failed");
    if (output.kind === "failed") {
      assert.equal(output.error.code, "CAPABILITY_RESOLVE_FAILED");
    }
    assert.equal(join.size(), 0);
    assert.equal(engine.opened.length, 0);
  });
});
