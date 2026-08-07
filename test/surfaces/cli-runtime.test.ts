/**
 * SURFACES (issue #3) — runtime control CLI (LIFE-S1).
 *
 * Scenario (e): CLI status/wait reflect parked then settled.
 * Plus: arg parsing for each subcommand, unknown subcommand exit 2, help text.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asRunId } from "../../src/domain/engagement.ts";
import type {
  RuntimeStatus,
} from "../../src/ports/runtime.ts";
import type { SurfacePort } from "../../src/ports/surface.ts";
import { parseArgs, printHelp, runCli } from "../../src/surfaces/cli.ts";

type Capture = {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
};

async function capture(
  fn: () => Promise<number>,
): Promise<Capture> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => { out.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { err.push(a.map(String).join(" ")); };
  try {
    const code = await fn();
    return { code, out, err };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

/**
 * Mock surface with a run that goes parked → settled (scenario e).
 * wake() transitions the run to settled so wait()/status() reflect it.
 */
function makeRuntimeSurface(): SurfacePort {
  const statuses = new Map<string, RuntimeStatus>();
  return {
    async engageLocal() {
      return {
        outcome: { kind: "settled", sessionRef: asRunId("cli-sess") as never },
        sessionRef: asRunId("cli-sess") as never,
        packSnapshotHash: "hash",
        definitionId: "cli-agent",
      };
    },
    async dispatch(req) {
      const runId = asRunId(req.clientRequestId ?? "cli-run");
      statuses.set(runId, { state: "running", parked: true });
      return { runId };
    },
    async getStatus(runId) {
      return statuses.get(runId) ?? { state: "pending" };
    },
    async wait(runId) {
      return statuses.get(runId) ?? { state: "pending" };
    },
    async cancel(runId) {
      statuses.set(runId, { state: "canceled" });
    },
    async wake(runId) {
      statuses.set(runId, {
        state: "completed",
        result: { kind: "settled", sessionRef: "cli-sess" },
      });
    },
  };
}

describe("CLI runtime control (LIFE-S1)", () => {
  it("parseArgs: dispatch subcommand", () => {
    const p = parseArgs([
      "dispatch",
      "--agent",
      "/tmp/agent",
      "--task",
      "durable",
      "--name",
      "d-agent",
      "--project-root",
      "/tmp/proj",
      "--wait",
    ]);
    assert.equal(p.command, "dispatch");
    assert.equal(p.agentDir, "/tmp/agent");
    assert.equal(p.task, "durable");
    assert.equal(p.name, "d-agent");
    assert.equal(p.projectRoot, "/tmp/proj");
    assert.equal(p.wait, true);
  });

  it("parseArgs: status / wait / cancel / wake subcommands", () => {
    const st = parseArgs(["status", "--run-id", "r-1"]);
    assert.equal(st.command, "status");
    assert.equal(st.runId, "r-1");

    const wa = parseArgs(["wait", "--run-id", "r-2", "--timeout-ms", "500"]);
    assert.equal(wa.command, "wait");
    assert.equal(wa.runId, "r-2");
    assert.equal(wa.timeoutMs, 500);

    const ca = parseArgs(["cancel", "--run-id", "r-3"]);
    assert.equal(ca.command, "cancel");
    assert.equal(ca.runId, "r-3");

    const wk = parseArgs([
      "wake",
      "--run-id",
      "r-4",
      "--text",
      "continue now",
      "--mode",
      "continue",
      "--park-intent",
      "--park-reason",
      "waiting on human",
    ]);
    assert.equal(wk.command, "wake");
    assert.equal(wk.runId, "r-4");
    assert.equal(wk.text, "continue now");
    assert.equal(wk.mode, "continue");
    assert.equal(wk.parkIntent, true);
    assert.equal(wk.parkReason, "waiting on human");
  });

  it("unknown subcommand exits 2", async () => {
    const cap = await capture(() => runCli(["frobnicate"]));
    assert.equal(cap.code, 2);
    assert.ok(cap.err.some((l) => l.includes("Commands:")), "help printed to stderr");
  });

  it("help text lists engage + runtime subcommands", () => {
    const help = printHelp();
    for (const cmd of ["engage", "dispatch", "status", "wait", "cancel", "wake"]) {
      assert.ok(help.includes(cmd), `help mentions ${cmd}`);
    }
  });

  it("missing required args for runtime subcommands exit 2", async () => {
    const c1 = await capture(() => runCli(["status"]));
    assert.equal(c1.code, 2);
    const c2 = await capture(() => runCli(["wake", "--run-id", "r"]));
    assert.equal(c2.code, 2);
  });

  it("dispatch prints runId (mock surface)", async () => {
    const surface = makeRuntimeSurface();
    const cap = await capture(() =>
      runCli(
        [
          "dispatch",
          "--agent",
          "/tmp/a",
          "--task",
          "t",
          "--name",
          "cli-agent",
          "--project-root",
          "/tmp",
          "--client-request-id",
          "cli-dispatch-1",
        ],
        { surface },
      ),
    );
    assert.equal(cap.code, 0);
    assert.ok(cap.out.join("\n").includes("cli-dispatch-1"), `got ${cap.out.join("\n")}`);
  });

  it("scenario (e): status shows parked, wake → wait shows settled", async () => {
    const surface = makeRuntimeSurface();
    const runId = "cli-run-e";

    // dispatch to seed the run
    const d = await capture(() =>
      runCli(
        [
          "dispatch",
          "--agent",
          "/tmp/a",
          "--task",
          "t",
          "--client-request-id",
          runId,
        ],
        { surface },
      ),
    );
    assert.equal(d.code, 0);

    const s1 = await capture(() =>
      runCli(["status", "--run-id", runId], { surface }),
    );
    assert.equal(s1.code, 0);
    assert.ok(s1.out.join("\n").includes("parked"), `status parked, got ${s1.out.join("\n")}`);

    const w = await capture(() =>
      runCli(["wake", "--run-id", runId, "--text", "go"], { surface }),
    );
    assert.equal(w.code, 0);
    assert.ok(w.out.join("\n").includes("wake"), "wake prints confirmation");

    const s2 = await capture(() =>
      runCli(["wait", "--run-id", runId, "--timeout-ms", "2000"], { surface }),
    );
    assert.equal(s2.code, 0);
    assert.ok(
      s2.out.join("\n").includes("settled"),
      `wait shows settled, got ${s2.out.join("\n")}`,
    );
  });

  it("cancel prints confirmation", async () => {
    const surface = makeRuntimeSurface();
    const cap = await capture(() =>
      runCli(["cancel", "--run-id", "cli-run-c"], { surface }),
    );
    assert.equal(cap.code, 0);
    assert.ok(cap.out.join("\n").includes("cli-run-c"));
  });

  it("engage --engine still honored (existing behavior intact)", async () => {
    const surface = makeRuntimeSurface();
    const cap = await capture(() =>
      runCli(
        [
          "engage",
          "--agent",
          "/tmp/a",
          "--task",
          "t",
          "--name",
          "cli-agent",
          "--engine",
          "mock",
        ],
        { surface },
      ),
    );
    assert.equal(cap.code, 0);
    const bad = await capture(() =>
      runCli(
        [
          "engage",
          "--agent",
          "/tmp/a",
          "--task",
          "t",
          "--engine",
          "bogus-engine",
        ],
        { surface },
      ),
    );
    assert.equal(bad.code, 2, "unknown --engine exits 2");
  });
});
