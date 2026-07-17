/**
 * ABS-C1: createSqliteRuntimeHost — sqlite OW compose productized.
 * Mock mind: construct host → worker start → dispatch → wait completed.
 * Default check — no live Pi keys.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createSqliteRuntimeHost } from "../../src/adapters/openworkflow/host.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../../src/adapters/packs/resolve-packs.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

function makeMockFactory(
  sessionRef = "mock-session-abs-c1",
): DefaultPresenceFactory {
  const engine = new MockEnginePort({
    sessionRefFactory: () => asSessionRef(sessionRef),
  });
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

describe("createSqliteRuntimeHost (ABS-C1, mock mind)", () => {
  const host = createSqliteRuntimeHost({
    dbPath: ":memory:",
    factory: makeMockFactory("mock-session-abs-c1"),
    resolveDefinition: (inp) =>
      agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
    pollIntervalMs: 15,
    concurrency: 2,
  });

  after(async () => {
    await host.stop();
  });

  it("constructs host with runtime, worker, join, ow", () => {
    assert.ok(host.runtime);
    assert.ok(host.worker);
    assert.ok(host.join);
    assert.ok(host.ow);
    assert.equal(typeof host.stop, "function");
    assert.equal(typeof host.worker.start, "function");
    assert.equal(typeof host.worker.stop, "function");
    assert.equal(typeof host.worker.tick, "function");
  });

  it("dispatch → worker → wait completed with Settled-shaped output", async () => {
    await host.worker.start();

    const handle = await host.runtime.dispatch({
      agent: { name: "case-basic-abs-c1", rootDir: FIXTURE_ROOT },
      task: "hello runtime host",
      clientRequestId: "abs-c1-dispatch-1",
    });

    assert.ok(handle.runId.length > 0);

    const status = await host.runtime.wait(handle.runId, { timeoutMs: 10_000 });
    assert.equal(
      status.state,
      "completed",
      `expected completed, got ${JSON.stringify(status)}`,
    );

    const result = status.result as {
      kind?: string;
      sessionRef?: string;
      packSnapshotHash?: string;
    };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.sessionRef, "mock-session-abs-c1");
    assert.equal(typeof result?.packSnapshotHash, "string");
    assert.equal(result?.packSnapshotHash?.length, 64);

    const record = await host.join.getByRunId(handle.runId);
    assert.ok(record, "join row for OW runId");
    assert.equal(record.status, "settled");
    assert.equal(record.sessionRef, "mock-session-abs-c1");
    assert.equal(record.definitionId, "case-basic-abs-c1");
    assert.equal(record.packSnapshot.planHash, result.packSnapshotHash);
  });

  it("optional registerPlan wires runPlan path", async () => {
    const planHost = createSqliteRuntimeHost({
      dbPath: ":memory:",
      factory: makeMockFactory("mock-session-abs-c1-plan"),
      resolveDefinition: (inp) =>
        agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      registerPlan: true,
      pollIntervalMs: 15,
    });

    try {
      await planHost.worker.start();

      const handle = await planHost.runtime.runPlan({
        id: "plan-abs-c1",
        nodes: [
          {
            id: "n1",
            agent: { name: "case-basic-abs-c1-n1", rootDir: FIXTURE_ROOT },
            task: "plan node one",
          },
        ],
      });

      const status = await planHost.runtime.wait(handle.runId, {
        timeoutMs: 10_000,
      });
      assert.equal(status.state, "completed");
      const result = status.result as {
        kind?: string;
        planId?: string;
        nodes?: readonly { nodeId: string; outcome: { kind: string } }[];
      };
      assert.equal(result?.kind, "completed");
      assert.equal(result?.planId, "plan-abs-c1");
      assert.equal(result?.nodes?.length, 1);
      assert.equal(result?.nodes?.[0]?.outcome.kind, "settled");
    } finally {
      await planHost.stop();
    }
  });
});
