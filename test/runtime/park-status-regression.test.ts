
/**
 * PARK STATUS + SQLITE NULL-GUARD REGRESSION (slice/phase2-parkfix).
 *
 * The parent-pinned repro: a hosted dispatch with parkIntent:true makes the
 * run stay "running" forever when observed via status-only polling. Root
 * cause: OW's sqlite backend keeps a signal-wait (parked) run in status
 * "running" (sleepWorkflowRun writes 'running' + future available_at; the
 * literal "sleeping" status never appears), so OpenWorkflowRuntime.getStatus
 * returned plain { state: "running" } forever — never parked.
 *
 * This suite drives the FULL hosted path (real OW worker + mock engine,
 * exactly like the extension's local composition) and asserts:
 *   1. join.status becomes "parked" (leaf parks) — pre-existing behavior;
 *   2. getStatus now reports parked:true while the arc waits for the wake
 *      signal (the fix: isRunParked probe on active signal-wait step);
 *   3. wake completes the run;
 *   4. cancel on a parked run lands in "canceled";
 *   5. SqliteJoinStore.put null-guards pack_snapshot_json (parameter 4) so
 *      a record without a packSnapshot binds "null" instead of throwing
 *      "Provided value cannot be bound to SQLite parameter 4".
 */

import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createHostedMediation } from "../../src/adapters/compose.ts";
import { SqliteJoinStore } from "../../src/adapters/join/sqlite-store.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

async function pollJoinParked(
  get: () => Promise<{ status: string } | null>,
  getStatus: () => Promise<{ state: string }>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await getStatus();
    if (
      st.state === "completed" ||
      st.state === "failed" ||
      st.state === "canceled"
    ) {
      throw new Error(`run left open continuum early: ${JSON.stringify(st)}`);
    }
    const j = await get();
    if (j?.status === "parked") return;
    await new Promise((r) => { setTimeout(r, 25); });
  }
  throw new Error("timeout waiting for join parked");
}

describe("park status through hosted OW worker (parkfix)", () => {
  const hosted = createHostedMediation({
    dbPath: ":memory:",
    mockEngine: true,
    projectRoot: FIXTURE_ROOT,
    fsStoreOptions: { homeDir: path.join(FIXTURE_ROOT, "_no_home") },
    pollIntervalMs: 15,
    concurrency: 2,
    resolveDefinition: (inp) =>
      agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
  });
  
  before(async () => {
    await hosted.worker.start();
  });

  after(async () => {
    await hosted.stop();
  });

  it("parked run reports state running + parked:true (not plain running)", async () => {
    const handle = await hosted.mediation.dispatch({
      agent: { name: "pf-park", rootDir: FIXTURE_ROOT },
      task: "park and wait",
      parkIntent: true,
      parkReason: "pf-need-human",
      clientRequestId: "pf-park-status",
    });

    await pollJoinParked(
      () => hosted.mediation.getJoinByRunId(handle.runId),
      () => hosted.mediation.getStatus(handle.runId),
    );

    const status = await hosted.mediation.getStatus(handle.runId);
    assert.equal(status.state, "running");
    if (status.state === "running") {
      // THE FIX: while the arc waits for wake, status must say parked.
      assert.equal(status.parked, true);
    }
    const join = await hosted.mediation.getJoinByRunId(handle.runId);
    assert.equal(join?.status, "parked");
    assert.equal(join?.parked?.reason, "pf-need-human");
  });

  it("wake completes a parked run (same sessionRef)", async () => {
    const handle = await hosted.mediation.dispatch({
      agent: { name: "pf-wake", rootDir: FIXTURE_ROOT },
      task: "park then wake",
      parkIntent: true,
      parkReason: "pf-wake-me",
      clientRequestId: "pf-wake",
    });

    await pollJoinParked(
      () => hosted.mediation.getJoinByRunId(handle.runId),
      () => hosted.mediation.getStatus(handle.runId),
    );
    const sessionRef = (await hosted.mediation.getJoinByRunId(handle.runId))!
      .sessionRef;

    await hosted.mediation.wake(handle.runId, {
      payloadText: "go on",
      mode: "continue",
    });

    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 10_000,
    });
    assert.equal(status.state, "completed");
    const result = status.result as { kind?: string; sessionRef?: string };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.sessionRef, sessionRef);
  });

  it("cancel on a parked run lands in canceled", async () => {
    const handle = await hosted.mediation.dispatch({
      agent: { name: "pf-cancel", rootDir: FIXTURE_ROOT },
      task: "park then cancel",
      parkIntent: true,
      parkReason: "pf-cancel-me",
      clientRequestId: "pf-cancel",
    });

    await pollJoinParked(
      () => hosted.mediation.getJoinByRunId(handle.runId),
      () => hosted.mediation.getStatus(handle.runId),
    );

    await hosted.mediation.cancel(handle.runId);
    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 10_000,
    });
    assert.equal(status.state, "canceled");
  });
});

describe("SqliteJoinStore pack_snapshot_json null-guard (parkfix)", () => {
  it("put with no packSnapshot binds null instead of throwing (param 4)", async () => {
    const join = new SqliteJoinStore({ path: ":memory:" });
    const runId = asRunId("run-nosnap-1");
    const sessionRef = asSessionRef("sess-nosnap-1");

    // A synthesized record for an un-parked / never-materialized run may
    // carry no packSnapshot. Pre-fix: JSON.stringify(undefined) → undefined
    // → node:sqlite "Provided value cannot be bound to SQLite parameter 4".
    await join.put({
      runId,
      sessionRef,
      definitionId: "ghost-agent",
      packSnapshot: undefined as never,
      status: "failed",
      updatedAt: "2026-08-08T00:00:00.000Z",
    });

    const got = await join.getByRunId(runId);
    assert.ok(got);
    assert.equal(got.status, "failed");
    assert.equal(got.sessionRef, sessionRef);
    join.close();
  });
});
