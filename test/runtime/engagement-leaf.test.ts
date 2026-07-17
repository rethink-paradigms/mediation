/**
 * S5a: Gamma engagement leaf body with MockEnginePort + PackResolver.
 * Proves materialize → join.put → engage → Settled without live Pi or OW worker.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import { runEngagementLeaf } from "../../src/adapters/openworkflow/workflows/engagement.ts";
import type { EngagementWorkflowInput } from "../../src/adapters/openworkflow/types.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

function makeFactory(engine: MockEnginePort): DefaultPresenceFactory {
  return new DefaultPresenceFactory({
    engine,
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: path.join(FIXTURE_ROOT, "_no_home"),
      }),
    ),
  });
}

function serializableRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("engagement leaf (Gamma structure, mock engine)", () => {
  it("materialize → join → engage → settled + packSnapshotHash", async () => {
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("mock-session-s5a"),
    });
    const factory = makeFactory(engine);
    const join = new MemoryJoinStore();
    const runId = asRunId("run-s5a-1");

    const input: EngagementWorkflowInput = {
      agentName: "case-basic",
      agentRoot: FIXTURE_ROOT,
      task: "hello gamma leaf",
      requestId: "req-1",
    };

    // Prove I/O types survive JSON (workflow boundary)
    const wireInput = serializableRoundTrip(input);
    assert.deepEqual(wireInput, input);

    const output = await runEngagementLeaf(wireInput, {
      factory,
      join,
      runId,
      resolveDefinition: (inp) =>
        agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
    });

    assert.equal(output.kind, "settled");
    if (output.kind === "settled") {
      assert.equal(output.sessionRef, "mock-session-s5a");
      assert.equal(typeof output.packSnapshotHash, "string");
      assert.equal(output.packSnapshotHash.length, 64);
    }

    const wireOut = serializableRoundTrip(output);
    assert.equal(wireOut.kind, "settled");

    const record = await join.getByRunId(runId);
    assert.ok(record);
    assert.equal(record.status, "settled");
    assert.equal(record.sessionRef, "mock-session-s5a");
    assert.equal(record.definitionId, "case-basic");
    assert.equal(record.packSnapshot.planHash, (output as { packSnapshotHash: string }).packSnapshotHash);

    const bySession = await join.getBySessionRef(asSessionRef("mock-session-s5a"));
    assert.ok(bySession);
    assert.equal(bySession.runId, runId);

    // headless leaf disposes presence; engine session was opened once
    assert.equal(engine.opened.length, 1);
  });

  it("resume sessionRef flows through materialize", async () => {
    const engine = new MockEnginePort();
    const factory = makeFactory(engine);
    const join = new MemoryJoinStore();

    const output = await runEngagementLeaf(
      {
        agentName: "resume-agent",
        agentRoot: FIXTURE_ROOT,
        task: "continue",
        sessionRef: "prior-session-s5a",
      },
      {
        factory,
        join,
        runId: asRunId("run-resume"),
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo"], inp.agentName),
      },
    );

    assert.equal(output.kind, "settled");
    if (output.kind === "settled") {
      assert.equal(output.sessionRef, "prior-session-s5a");
    }
  });

  it("fail-closed pack resolve → failed output, no join row", async () => {
    const engine = new MockEnginePort();
    const factory = makeFactory(engine);
    const join = new MemoryJoinStore();

    const output = await runEngagementLeaf(
      {
        agentName: "bad-packs",
        agentRoot: FIXTURE_ROOT,
        task: "nope",
      },
      {
        factory,
        join,
        runId: asRunId("run-fail-pack"),
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

describe("MemoryJoinStore", () => {
  it("put / get / updateStatus", async () => {
    const join = new MemoryJoinStore();
    const runId = asRunId("j1");
    const sessionRef = asSessionRef("s1");
    await join.put({
      runId,
      sessionRef,
      definitionId: "d1",
      packSnapshot: {
        planHash: "abc",
        packs: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      status: "materializing",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal((await join.getByRunId(runId))?.status, "materializing");
    await join.updateStatus(runId, "engaging");
    assert.equal((await join.getByRunId(runId))?.status, "engaging");
    assert.equal((await join.getBySessionRef(sessionRef))?.runId, runId);
  });
});
