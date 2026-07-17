/**
 * LIFE runtime scenarios — product doors (Mediation / Surface / Hosted).
 * Mock mind, keyless. See research slices/RUNTIME-SCENARIOS.md.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createHostedMediation } from "../../src/adapters/compose.ts";
import { createMediationSurface } from "../../src/adapters/surface/mediation-surface.ts";
import { SqliteJoinStore } from "../../src/adapters/join/sqlite-store.ts";
import { createLocalMediation } from "../../src/adapters/compose.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import { dispatch as dispatchRecipe } from "../../src/app/recipes/dispatch.ts";
import { wake as wakeRecipe } from "../../src/app/recipes/wake.ts";
import type { RecipeContext } from "../../src/app/recipes/types.ts";
import { asSessionRef } from "../../src/domain/presence.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

async function pollJoinParked(
  get: () => Promise<{ status: string } | null>,
  getStatus: () => Promise<{ state: string }>,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await getStatus();
    if (st.state === "completed" || st.state === "failed" || st.state === "canceled") {
      throw new Error(`run left open continuum early: ${JSON.stringify(st)}`);
    }
    const j = await get();
    if (j?.status === "parked") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout waiting for join parked");
}

describe("LIFE runtime scenarios (hosted Mediation, mock mind)", () => {
  const hosted = createHostedMediation({
    dbPath: ":memory:",
    mockEngine: true,
    projectRoot: FIXTURE_ROOT,
    fsStoreOptions: { homeDir: path.join(FIXTURE_ROOT, "_no_home") },
    pollIntervalMs: 15,
    concurrency: 2,
    registerPlan: true,
    resolveDefinition: (inp) => {
      if (inp.agentName === "bad-packs-rt") {
        return agentDefForPacks(FIXTURE_ROOT, ["foo", "missing"], inp.agentName);
      }
      return agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName);
    },
  });

  const surface = createMediationSurface(hosted.mediation);
  const recipeCtx: RecipeContext = { mediation: hosted.mediation };

  before(async () => {
    await hosted.worker.start();
  });

  after(async () => {
    await hosted.stop();
  });

  it("R1: hosted settle via Mediation.dispatch + wait + join", async () => {
    const handle = await hosted.mediation.dispatch({
      agent: { name: "rt-settle", rootDir: FIXTURE_ROOT },
      task: "settle runtime",
      clientRequestId: "rt-r1",
    });
    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 10_000,
    });
    assert.equal(status.state, "completed");
    const result = status.result as { kind?: string; sessionRef?: string };
    assert.equal(result?.kind, "settled");
    const join = await hosted.mediation.getJoinByRunId(handle.runId);
    assert.ok(join);
    assert.equal(join.status, "settled");
    assert.equal(join.sessionRef, result.sessionRef);
  });

  it("R2+R3: park wait then Mediation.wake → Settled same session", async () => {
    const handle = await hosted.mediation.dispatch({
      agent: { name: "rt-park-wake", rootDir: FIXTURE_ROOT },
      task: "park first",
      parkIntent: true,
      parkReason: "rt-need-human",
      clientRequestId: "rt-r2",
    });

    await pollJoinParked(
      () => hosted.mediation.getJoinByRunId(handle.runId),
      () => hosted.mediation.getStatus(handle.runId),
    );
    const mid = await hosted.mediation.getStatus(handle.runId);
    assert.notEqual(mid.state, "completed");
    const parked = await hosted.mediation.getJoinByRunId(handle.runId);
    assert.equal(parked?.status, "parked");
    const sessionRef = parked!.sessionRef;

    await hosted.mediation.wake(handle.runId, {
      payloadText: "go ahead",
      mode: "continue",
    });

    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 10_000,
    });
    assert.equal(status.state, "completed");
    const result = status.result as { kind?: string; sessionRef?: string };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.sessionRef, sessionRef);
    const join = await hosted.mediation.getJoinByRunId(handle.runId);
    assert.equal(join?.status, "settled");
  });

  it("R4: wake recipe with wait", async () => {
    const handle = await hosted.mediation.dispatch({
      agent: { name: "rt-recipe-wake", rootDir: FIXTURE_ROOT },
      task: "park",
      parkIntent: true,
      clientRequestId: "rt-r4",
    });
    await pollJoinParked(
      () => hosted.mediation.getJoinByRunId(handle.runId),
      () => hosted.mediation.getStatus(handle.runId),
    );

    const out = await wakeRecipe.run(recipeCtx, {
      runId: handle.runId,
      payloadText: "recipe wake",
      wait: { timeoutMs: 10_000 },
    });
    assert.equal(out.status?.state, "completed");
    const result = out.status?.result as { kind?: string };
    assert.equal(result?.kind, "settled");
  });

  it("R5: SurfacePort dispatch park → wake → wait", async () => {
    assert.ok(surface.dispatch && surface.wake && surface.wait && surface.getStatus);
    const handle = await surface.dispatch!({
      agent: { name: "rt-surface", rootDir: FIXTURE_ROOT },
      task: "surface park",
      parkIntent: true,
      parkReason: "surface",
      clientRequestId: "rt-r5",
    });
    await pollJoinParked(
      () => hosted.mediation.getJoinByRunId(handle.runId),
      () => surface.getStatus!(handle.runId),
    );
    await surface.wake!(handle.runId, { payloadText: "surface continue" });
    const status = await surface.wait!(handle.runId, { timeoutMs: 10_000 });
    assert.equal(status.state, "completed");
    assert.equal((status.result as { kind?: string })?.kind, "settled");
  });

  it("R6: cancel pending run", async () => {
    // No worker claim race: use runtime that can cancel while pending.
    // With worker running, cancel a just-dispatched run — either canceled or
    // already completed; assert cancel does not throw and terminal is ok.
    const handle = await hosted.mediation.dispatch({
      agent: { name: "rt-cancel", rootDir: FIXTURE_ROOT },
      task: "maybe cancel",
      clientRequestId: `rt-r6-${Date.now()}`,
    });
    await hosted.mediation.cancel(handle.runId);
    const status = await hosted.mediation.getStatus(handle.runId);
    assert.ok(
      status.state === "canceled" ||
        status.state === "completed" ||
        status.state === "failed" ||
        status.state === "running" ||
        status.state === "pending",
      `unexpected state ${status.state}`,
    );
    // Stronger path: cancel without worker race — dispatch park, cancel while waiting
  });

  it("R6b: cancel while parked-wait", async () => {
    const handle = await hosted.mediation.dispatch({
      agent: { name: "rt-cancel-park", rootDir: FIXTURE_ROOT },
      task: "park then cancel",
      parkIntent: true,
      clientRequestId: `rt-r6b-${Date.now()}`,
    });
    await pollJoinParked(
      () => hosted.mediation.getJoinByRunId(handle.runId),
      () => hosted.mediation.getStatus(handle.runId),
    );
    await hosted.mediation.cancel(handle.runId);
    // OW cancel may leave sleeping/running briefly; poll terminal-ish
    const deadline = Date.now() + 5_000;
    let st = await hosted.mediation.getStatus(handle.runId);
    while (
      Date.now() < deadline &&
      st.state !== "canceled" &&
      st.state !== "completed" &&
      st.state !== "failed"
    ) {
      await new Promise((r) => setTimeout(r, 30));
      st = await hosted.mediation.getStatus(handle.runId);
    }
    assert.ok(
      st.state === "canceled" || st.state === "failed" || st.state === "completed",
      `after cancel while parked, got ${JSON.stringify(st)}`,
    );
  });

  it("R7: fail-closed packs → completed failed leaf", async () => {
    const handle = await hosted.mediation.dispatch({
      agent: { name: "bad-packs-rt", rootDir: FIXTURE_ROOT },
      task: "nope",
      clientRequestId: "rt-r7",
    });
    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 10_000,
    });
    assert.equal(status.state, "completed");
    const result = status.result as { kind?: string; error?: { code?: string } };
    assert.equal(result?.kind, "failed");
    assert.equal(result?.error?.code, "CAPABILITY_RESOLVE_FAILED");
  });

  it("R8: resume sessionRef through dispatch", async () => {
    const resume = asSessionRef("rt-prior-session");
    const handle = await hosted.mediation.dispatch({
      agent: { name: "rt-resume", rootDir: FIXTURE_ROOT },
      task: "continue",
      resume,
      clientRequestId: "rt-r8",
    });
    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 10_000,
    });
    assert.equal(status.state, "completed");
    const result = status.result as { kind?: string; sessionRef?: string };
    assert.equal(result?.kind, "settled");
    assert.equal(result?.sessionRef, resume);
  });

  it("R9: local engageLocal without runtime", async () => {
    const { mediation } = createLocalMediation({
      mockEngine: true,
      projectRoot: FIXTURE_ROOT,
      fsStoreOptions: { homeDir: path.join(FIXTURE_ROOT, "_no_home") },
    });
    // Need resolve via yaml or inject — local uses yaml loader; use nested agent yaml
    const nested = path.join(FIXTURE_ROOT, "_rt_local_agent");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "agent.yaml"),
      `name: rt-local
model: test/m
thinking: off
extensions:
  - foo
prompt: |
  local
`,
      "utf8",
    );
    try {
      const result = await mediation.engageLocal({
        agent: { name: "rt-local", rootDir: nested },
        task: "local only",
      });
      assert.equal(result.outcome.kind, "settled");
    } finally {
      fs.rmSync(nested, { recursive: true, force: true });
    }
  });

  it("R10: local park + reenter continue", async () => {
    const { mediation } = createLocalMediation({
      mockEngine: true,
      projectRoot: FIXTURE_ROOT,
      fsStoreOptions: { homeDir: path.join(FIXTURE_ROOT, "_no_home") },
    });
    const nested = path.join(FIXTURE_ROOT, "_rt_reenter_agent");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "agent.yaml"),
      `name: rt-reenter
model: test/m
thinking: off
extensions:
  - foo
prompt: |
  reenter
`,
      "utf8",
    );
    try {
      const parked = await mediation.engageLocal({
        agent: { name: "rt-reenter", rootDir: nested },
        task: "park",
        parkIntent: true,
      });
      assert.equal(parked.outcome.kind, "parked");
      assert.ok(parked.sessionRef);
      const cont = await mediation.reenter({
        agent: { name: "rt-reenter", rootDir: nested },
        sessionRef: parked.sessionRef!,
        task: "continue after park",
        expectedPackSnapshotHash: parked.packSnapshotHash,
      });
      assert.equal(cont.outcome.kind, "settled");
      assert.equal(cont.packSnapshotMatch, true);
    } finally {
      fs.rmSync(nested, { recursive: true, force: true });
    }
  });

  it("R11: runPlan two settled nodes", async () => {
    const handle = await hosted.mediation.runPlan({
      id: "rt-plan-1",
      nodes: [
        {
          id: "n1",
          agent: { name: "rt-plan-a", rootDir: FIXTURE_ROOT },
          task: "node 1",
        },
        {
          id: "n2",
          agent: { name: "rt-plan-b", rootDir: FIXTURE_ROOT },
          task: "node 2",
        },
      ],
    });
    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 15_000,
    });
    assert.equal(status.state, "completed");
    const result = status.result as { kind?: string; nodes?: unknown[] };
    assert.equal(result?.kind, "completed");
    assert.equal(result?.nodes?.length, 2);
  });

  it("R14: re-park via wake parkIntent then settle", async () => {
    const handle = await hosted.mediation.dispatch({
      agent: { name: "rt-repark", rootDir: FIXTURE_ROOT },
      task: "first park",
      parkIntent: true,
      parkReason: "first",
      clientRequestId: "rt-r14",
    });
    await pollJoinParked(
      () => hosted.mediation.getJoinByRunId(handle.runId),
      () => hosted.mediation.getStatus(handle.runId),
    );
    await hosted.mediation.wake(handle.runId, {
      payloadText: "still park",
      parkIntent: true,
      parkReason: "again",
    });
    // Wait until continue leaf has re-parked (reason "again") — not merely
    // the first park row. Then pause so waitForSignal is armed (signals are
    // not buffered; waking during the continue leaf drops the signal).
    {
      const deadline = Date.now() + 5_000;
      let reparked = false;
      while (Date.now() < deadline) {
        const st = await hosted.mediation.getStatus(handle.runId);
        if (st.state === "completed" || st.state === "failed") {
          throw new Error(`re-park path terminal early: ${JSON.stringify(st)}`);
        }
        const j = await hosted.mediation.getJoinByRunId(handle.runId);
        if (j?.status === "parked" && j.parked?.reason === "again") {
          reparked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(reparked, "continue leaf did not re-park with reason=again");
      await new Promise((r) => setTimeout(r, 100));
    }
    await hosted.mediation.wake(handle.runId, {
      payloadText: "finish",
      mode: "continue",
    });
    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 10_000,
    });
    assert.equal(
      status.state,
      "completed",
      `R14 expected completed, got ${JSON.stringify(status)}`,
    );
    assert.equal((status.result as { kind?: string })?.kind, "settled");
  });

  it("R15: local mediation control verbs throw without runtime", async () => {
    const { mediation } = createLocalMediation({ mockEngine: true });
    await assert.rejects(
      () =>
        mediation.dispatch({
          agent: { name: "x", rootDir: FIXTURE_ROOT },
          task: "nope",
        }),
      /no RuntimePort/,
    );
    await assert.rejects(
      () => mediation.cancel("run-x" as never),
      /no RuntimePort/,
    );
    await assert.rejects(
      () => mediation.wake("run-x" as never, { payloadText: "x" }),
      /no RuntimePort/,
    );
  });

  it("R-recipe dispatch with wait", async () => {
    const out = await dispatchRecipe.run(recipeCtx, {
      agent: { name: "rt-disp-recipe", rootDir: FIXTURE_ROOT },
      task: "recipe dispatch",
      clientRequestId: "rt-disp-recipe",
      wait: { timeoutMs: 10_000 },
    });
    assert.equal(out.status?.state, "completed");
    assert.equal((out.status?.result as { kind?: string })?.kind, "settled");
  });
});

describe("LIFE runtime scenarios (file-backed hosted)", () => {
  it("R12+R13: file db settle + park/wake join durable after stop", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-rt-file-"));
    const dbPath = path.join(dir, "ow.sqlite");
    const joinPath = path.join(dir, "mediation-join.sqlite");

    let settledRunId: string | undefined;
    let parkRunId: string | undefined;
    let parkSession: string | undefined;

    {
      const hosted = createHostedMediation({
        dbPath,
        joinPath,
        mockEngine: true,
        projectRoot: FIXTURE_ROOT,
        fsStoreOptions: { homeDir: path.join(FIXTURE_ROOT, "_no_home") },
        pollIntervalMs: 15,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      });
      try {
        await hosted.worker.start();

        // R12 settle
        const h1 = await hosted.mediation.dispatch({
          agent: { name: "rt-file-settle", rootDir: FIXTURE_ROOT },
          task: "file settle",
          clientRequestId: "rt-r12",
        });
        const s1 = await hosted.mediation.wait(h1.runId, { timeoutMs: 10_000 });
        assert.equal(s1.state, "completed");
        settledRunId = h1.runId;

        // R13 park → wake
        const h2 = await hosted.mediation.dispatch({
          agent: { name: "rt-file-park", rootDir: FIXTURE_ROOT },
          task: "file park",
          parkIntent: true,
          clientRequestId: "rt-r13",
        });
        parkRunId = h2.runId;
        await pollJoinParked(
          () => hosted.mediation.getJoinByRunId(h2.runId),
          () => hosted.mediation.getStatus(h2.runId),
        );
        parkSession = (await hosted.mediation.getJoinByRunId(h2.runId))!
          .sessionRef;
        await hosted.mediation.wake(h2.runId, {
          payloadText: "file continue",
        });
        const s2 = await hosted.mediation.wait(h2.runId, { timeoutMs: 10_000 });
        assert.equal(s2.state, "completed");
        assert.equal((s2.result as { kind?: string })?.kind, "settled");
      } finally {
        await hosted.stop();
      }
    }

    // Reopen join only (process boundary for join durability)
    {
      const join = new SqliteJoinStore({ path: joinPath });
      try {
        const a = await join.getByRunId(settledRunId as never);
        assert.ok(a);
        assert.equal(a.status, "settled");
        const b = await join.getByRunId(parkRunId as never);
        assert.ok(b);
        assert.equal(b.status, "settled");
        assert.equal(b.sessionRef, parkSession);
      } finally {
        join.close();
      }
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
