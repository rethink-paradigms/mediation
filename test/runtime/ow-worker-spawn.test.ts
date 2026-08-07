/**
 * OW Worker + spawn mode integration (file-backed).
 *
 * Tests the full path:
 *   dispatch → OW Worker → spawn-leaf → engagement-runner (child) → result flows back
 *
 * Uses file-backed SQLite databases so the child process can connect to the
 * same files. Not `:memory:` because child processes are separate OS processes.
 *
 * Park/wake in spawn mode is not tested here because the mock engine does not
 * support parking. The park/wake arc logic is unchanged between in-process and
 * spawn mode — only the leaf execution strategy changes.
 */

import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { afterEach, describe, it } from "node:test";

import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { OpenWorkflowRuntime } from "../../src/adapters/openworkflow/runtime.ts";
import { registerEngagementWorkflow } from "../../src/adapters/openworkflow/register-engagement.ts";
import { createSpawnLeaf } from "../../src/adapters/openworkflow/spawn-leaf.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

let tmpDirs: string[] = [];
let hosts: Array<{
  worker: { stop(): Promise<void> };
  backend: { stop(): Promise<void> };
}> = [];

afterEach(async () => {
  for (const h of hosts) {
    try { await h.worker.stop(); } catch {
      // ignore
    }
    try { await h.backend.stop(); } catch {
      // ignore
    }
  }
  hosts = [];
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true }); } catch {
      // already gone
    }
  }
  tmpDirs = [];
});

function tmpDir(): string {
  const d = fs.mkdtempSync("/tmp/spawn-ow-test-");
  tmpDirs.push(d);
  return d;
}

function makeHost(dbPath: string, joinPath: string) {
  const backend = BackendSqlite.connect(dbPath);
  const ow = new OpenWorkflow({ backend });
  const join = new MemoryJoinStore();
  const factory = new DefaultPresenceFactory({
    engine: new MockEnginePort({
      sessionRefFactory: () => asSessionRef("spawn-session"),
    }),
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: path.join(FIXTURE_ROOT, "_no_home"),
      }),
    ),
  });

  const leafExec = createSpawnLeaf({
    joinPath,
    projectRoot: FIXTURE_ROOT,
    usePi: false,
  });

  const { engagementSpec } = registerEngagementWorkflow(ow, {
    factory,
    join,
    resolveDefinition: (inp) =>
      agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
    executeLeaf: leafExec,
  });

  const runtime = new OpenWorkflowRuntime({
    ow,
    backend: { getWorkflowRun: (p) => backend.getWorkflowRun(p) },
    engagementSpec,
    pollIntervalMs: 15,
  });

  const worker = ow.newWorker({ concurrency: 1 });
  return { runtime, worker, join, backend };
}

describe("OW Worker + spawn mode (file-backed DB)", () => {
  it("dispatch → worker spawns child → completed with settled output", async () => {
    const root = tmpDir();
    const dbPath = path.join(root, "ow.sqlite");
    const joinPath = path.join(root, "join.sqlite");

    const host = makeHost(dbPath, joinPath);
    hosts.push(host);
    await host.worker.start();

    const handle = await host.runtime.dispatch({
      agent: { name: "spawn-int-agent", rootDir: FIXTURE_ROOT },
      task: "test spawn mode integration",
      clientRequestId: "spawn-int-001",
    });

    assert.ok(handle.runId.length > 0);

    const status = await host.runtime.wait(handle.runId, { timeoutMs: 20_000 });
    assert.equal(
      status.state,
      "completed",
      `expected completed, got ${JSON.stringify(status)}`,
    );

    const result = status.result as Record<string, unknown>;
    assert.equal(
      result?.kind,
      "settled",
      `expected settled outcome, got ${JSON.stringify(result)}`,
    );
    assert.equal(typeof result?.packSnapshotHash, "string");
  });
});
