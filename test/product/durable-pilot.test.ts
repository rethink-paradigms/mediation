/**
 * PRODUCT-1 — durable hosted join + optional real coding-agent pilot.
 * Default check: mock mind, keyless. Optional skips when company agent absent.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createHostedMediation,
  createLocalMediation,
  defaultHostedJoinPath,
  resolveHostedJoin,
} from "../../src/adapters/compose.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { SqliteJoinStore } from "../../src/adapters/join/sqlite-store.ts";
import { capabilitySpecFromDefinition } from "../../src/app/factory.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const COMPANY_ROOT = path.resolve(HERE, "../../../../");
const CODING_AGENT_ROOT = path.join(COMPANY_ROOT, "agents", "coding-agent");
const hasCodingAgent = fs.existsSync(
  path.join(CODING_AGENT_ROOT, "agent.yaml"),
);

describe("PRODUCT-1 resolveHostedJoin policy", () => {
  it("memory dbPath → MemoryJoinStore when join omitted", () => {
    const { join, ownedSqliteJoin } = resolveHostedJoin({
      dbPath: ":memory:",
    });
    assert.ok(join instanceof MemoryJoinStore);
    assert.equal(ownedSqliteJoin, null);
  });

  it("file dbPath → owned SqliteJoinStore at default sibling path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-p1-join-"));
    const dbPath = path.join(dir, "ow.sqlite");
    const expected = defaultHostedJoinPath(dbPath);
    assert.equal(path.basename(expected), "mediation-join.sqlite");
    assert.equal(path.dirname(expected), path.resolve(dir));

    const { join, ownedSqliteJoin } = resolveHostedJoin({ dbPath });
    assert.ok(join instanceof SqliteJoinStore);
    assert.ok(ownedSqliteJoin);
    assert.equal(ownedSqliteJoin, join);
    assert.ok(fs.existsSync(expected), "join file created on open");
    ownedSqliteJoin.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("explicit joinPath overrides default sibling", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-p1-jp-"));
    const dbPath = path.join(dir, "ow.sqlite");
    const joinPath = path.join(dir, "custom-join.sqlite");
    const { ownedSqliteJoin } = resolveHostedJoin({ dbPath, joinPath });
    assert.ok(ownedSqliteJoin);
    assert.ok(fs.existsSync(joinPath));
    ownedSqliteJoin.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("injected join is never owned", () => {
    const injected = new MemoryJoinStore();
    const { join, ownedSqliteJoin } = resolveHostedJoin({
      dbPath: "/tmp/whatever.sqlite",
      join: injected,
    });
    assert.equal(join, injected);
    assert.equal(ownedSqliteJoin, null);
  });
});

describe("PRODUCT-1 durable hosted dispatch (mock mind, file sqlite)", () => {
  it("dispatch → wait → stop → reopen join row survives", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-p1-host-"));
    const dbPath = path.join(dir, "ow.sqlite");
    const joinPath = path.join(dir, "mediation-join.sqlite");

    let runId: string;
    let sessionRef: string;
    let packSnapshotHash: string;

    {
      const hosted = createHostedMediation({
        dbPath,
        joinPath,
        mockEngine: true,
        projectRoot: FIXTURE_ROOT,
        fsStoreOptions: {
          homeDir: path.join(FIXTURE_ROOT, "_no_home"),
        },
        pollIntervalMs: 15,
        concurrency: 1,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      });

      assert.ok(
        hosted.join instanceof SqliteJoinStore,
        "file dbPath defaults durable join",
      );

      try {
        await hosted.worker.start();
        const handle = await hosted.mediation.dispatch({
          agent: { name: "product-1-pilot", rootDir: FIXTURE_ROOT },
          task: "product durable pilot turn",
          clientRequestId: "product-1-dispatch-1",
        });
        runId = handle.runId;

        const status = await hosted.mediation.wait(handle.runId, {
          timeoutMs: 10_000,
        });
        assert.equal(status.state, "completed");
        const result = status.result as {
          kind?: string;
          sessionRef?: string;
          packSnapshotHash?: string;
        };
        assert.equal(result?.kind, "settled");
        sessionRef = result.sessionRef ?? "";
        packSnapshotHash = result.packSnapshotHash ?? "";
        assert.ok(sessionRef.length > 0);
        assert.equal(packSnapshotHash.length, 64);

        const live = await hosted.mediation.getJoinByRunId(handle.runId);
        assert.ok(live);
        assert.equal(live.status, "settled");
        assert.equal(live.sessionRef, sessionRef);
        assert.equal(live.packSnapshot.planHash, packSnapshotHash);
      } finally {
        await hosted.stop();
      }
    }

    // Process-boundary simulation: new SqliteJoinStore on same file.
    {
      const join = new SqliteJoinStore({ path: joinPath });
      try {
        const got = await join.getByRunId(runId as never);
        assert.ok(got, "join row durable after stop");
        assert.equal(got.status, "settled");
        assert.equal(got.sessionRef, sessionRef);
        assert.equal(got.definitionId, "product-1-pilot");
        assert.equal(got.packSnapshot.planHash, packSnapshotHash);

        const bySession = await join.getBySessionRef(sessionRef as never);
        assert.ok(bySession);
        assert.equal(bySession.runId, runId);
      } finally {
        join.close();
      }
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it(":memory: hosted still uses MemoryJoinStore", () => {
    const hosted = createHostedMediation({
      dbPath: ":memory:",
      mockEngine: true,
      projectRoot: FIXTURE_ROOT,
      fsStoreOptions: { homeDir: path.join(FIXTURE_ROOT, "_no_home") },
      resolveDefinition: (inp) =>
        agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
    });
    assert.ok(hosted.join instanceof MemoryJoinStore);
    // stop is async; fire-and-forget for construct-only smoke
    void hosted.stop();
  });
});

describe("PRODUCT-1 optional coding-agent pilot (skip if absent)", () => {
  it(
    "loads coding-agent and CapabilityResolver ok against company root",
    { skip: !hasCodingAgent },
    async () => {
      const { mediation } = createLocalMediation({
        mockEngine: true,
        projectRoot: COMPANY_ROOT,
      });
      const def = await mediation.load({
        name: "coding-agent",
        rootDir: CODING_AGENT_ROOT,
      });
      assert.equal(def.name, "coding-agent");
      assert.ok((def.extensions?.length ?? 0) > 0);
      assert.ok((def.prompt ?? "").length > 0);

      const store = createFsCapabilityStore({ projectRoot: COMPANY_ROOT });
      const resolver = createCapabilityResolver(store);
      const resolved = await resolver.resolve({
        layers: [
          { kind: "agent", spec: capabilitySpecFromDefinition(def) },
        ],
      });
      assert.equal(
        resolved.plan.ok,
        true,
        `expected all coding-agent caps found; diagnostics=${JSON.stringify(resolved.plan.diagnostics)}`,
      );
      assert.equal(
        resolved.artifacts.length,
        def.extensions!.length,
        "artifact count matches extension list",
      );
    },
  );

  it(
    "engageLocal mock mind Settled for coding-agent (capability path)",
    { skip: !hasCodingAgent },
    async () => {
      const { mediation } = createLocalMediation({
        mockEngine: true,
        projectRoot: COMPANY_ROOT,
      });
      const result = await mediation.engageLocal({
        agent: { name: "coding-agent", rootDir: CODING_AGENT_ROOT },
        task: "product pilot: say hello via monocoque (mock mind)",
      });
      assert.equal(result.outcome.kind, "settled");
      assert.equal(typeof result.sessionRef, "string");
      assert.equal(typeof result.packSnapshotHash, "string");
      assert.equal(result.packSnapshotHash?.length, 64);
      assert.equal(result.definitionId, "coding-agent");
    },
  );
});
