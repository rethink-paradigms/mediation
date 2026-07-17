/**
 * ABS-C2: createHostedMediation — Mediation + createSqliteRuntimeHost.
 * Mock mind: worker start → mediation.dispatch → wait completed;
 * engageLocal still works on the same composition.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createHostedMediation } from "../../src/adapters/compose.ts";
import { agentDefForPacks } from "../../src/adapters/packs/resolve-packs.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const DEF_FIXTURE = path.resolve(HERE, "../../fixtures/definition/case-basic");

describe("createHostedMediation (ABS-C2, mock mind)", () => {
  const hosted = createHostedMediation({
    dbPath: ":memory:",
    mockEngine: true,
    projectRoot: FIXTURE_ROOT,
    fsStoreOptions: {
      homeDir: path.join(FIXTURE_ROOT, "_no_home"),
    },
    pollIntervalMs: 15,
    concurrency: 2,
    resolveDefinition: (inp) =>
      agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
  });

  after(async () => {
    await hosted.stop();
  });

  it("exposes mediation, host, runtime, worker, join, stop", () => {
    assert.ok(hosted.mediation);
    assert.ok(hosted.host);
    assert.ok(hosted.runtime);
    assert.ok(hosted.worker);
    assert.ok(hosted.join);
    assert.equal(typeof hosted.stop, "function");
    assert.equal(hosted.runtime, hosted.host.runtime);
    assert.equal(hosted.join, hosted.host.join);
  });

  it("mediation.dispatch → worker → wait completed with Settled-shaped output", async () => {
    await hosted.worker.start();

    const handle = await hosted.mediation.dispatch({
      agent: { name: "case-basic-abs-c2", rootDir: FIXTURE_ROOT },
      task: "hello hosted mediation",
      clientRequestId: "abs-c2-dispatch-1",
    });

    assert.ok(handle.runId.length > 0);

    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 10_000,
    });
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
    assert.equal(typeof result?.sessionRef, "string");
    assert.ok((result?.sessionRef ?? "").length > 0);
    assert.equal(typeof result?.packSnapshotHash, "string");
    assert.equal(result?.packSnapshotHash?.length, 64);

    const record = await hosted.mediation.getJoinByRunId(handle.runId);
    assert.ok(record, "join row for OW runId");
    assert.equal(record.status, "settled");
    assert.equal(record.sessionRef, result.sessionRef);
    assert.equal(record.definitionId, "case-basic-abs-c2");
    assert.equal(record.packSnapshot.planHash, result.packSnapshotHash);
  });

  it("engageLocal still works on hosted composition", async () => {
    const nested = path.join(FIXTURE_ROOT, "_abs_c2_engage_local");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "agent.yaml"),
      `name: abs-c2-local
model: test/model
thinking: off
extensions:
  - foo
prompt: |
  You are a test agent.
`,
      "utf8",
    );

    try {
      const result = await hosted.mediation.engageLocal({
        agent: { name: "abs-c2-local", rootDir: nested },
        task: "local turn on hosted mediation",
      });
      assert.equal(result.outcome.kind, "settled");
      assert.equal(typeof result.sessionRef, "string");
      assert.equal(typeof result.packSnapshotHash, "string");
      assert.equal(result.definitionId, "abs-c2-local");
    } finally {
      fs.rmSync(nested, { recursive: true, force: true });
    }
  });

  it("createHostedMediation default resolve uses yaml loader for load()", async () => {
    const yamlHosted = createHostedMediation({
      dbPath: ":memory:",
      mockEngine: true,
      projectRoot: DEF_FIXTURE,
      pollIntervalMs: 15,
    });
    try {
      const def = await yamlHosted.mediation.load({
        name: "case-basic",
        rootDir: DEF_FIXTURE,
      });
      assert.equal(def.name, "case-basic");
      assert.ok((def.prompt ?? "").length > 0);
    } finally {
      await yamlHosted.stop();
    }
  });
});
