/**
 * GATED LIVE — park→wake→continue on real Pi (issue #1).
 *
 * Gate: MEDIATION_LIVE_PI=1 (deepseek/deepseek-v4-flash, auth
 * ~/.pi/agent/auth.json). Skipped in keyless `npm run check`.
 *
 *   MEDIATION_LIVE_PI=1 MEDIATION_LIVE_MODEL=deepseek/deepseek-v4-flash \
 *     node --experimental-strip-types --test test/runtime/live-park-wake-pi.test.ts
 *
 * Scenarios (TESTING-DOCTRINE rule 4 — engine paths get a gated live scenario):
 *   L-W1 hosted parkIntent → wake default continue → Settled same sessionRef
 *        (D1 ParkBridge: whatWasAwaited + payload appended as user message)
 *   L-W2 local park → reenter default continue → Settled same sessionRef
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  createHostedMediation,
  createLocalMediation,
} from "../../src/adapters/compose.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";

const LIVE = process.env.MEDIATION_LIVE_PI === "1";
const HERE = import.meta.dirname;
const PKG_ROOT = path.resolve(HERE, "../..");

const LIVE_MODEL =
  process.env.MEDIATION_LIVE_MODEL ??
  process.env.PI_MODEL ??
  "deepseek/deepseek-v4-flash";

const WAIT_MS = 120_000;

function liveDef(
  name: string,
  rootDir: string,
  promptExtra = "Reply with exactly: pong",
): AgentDefinition {
  return {
    id: name,
    name,
    rootDir,
    model: LIVE_MODEL,
    thinking: "off",
    prompt: `You are a minimal mediation live park-wake probe. ${promptExtra}`,
    tools: { agentMode: "static", builtin: [] },
  };
}

function writeLiveAgentYaml(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "agent.yaml"),
    `name: ${name}
model: ${LIVE_MODEL}
thinking: off
prompt: |
  You are a minimal mediation live park-wake probe. Reply with exactly: pong
tools:
  agentMode: static
  builtin: []
`,
    "utf8",
  );
}

async function pollJoinParked(
  get: () => Promise<{ status: string } | null>,
  getStatus: () => Promise<{ state: string }>,
  timeoutMs = 90_000,
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
    await new Promise((r) => { setTimeout(r, 50); });
  }
  throw new Error("timeout waiting for join parked");
}

describe(
  "live park→wake→continue on real Pi (MEDIATION_LIVE_PI=1)",
  { skip: !LIVE },
  () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-live-pw-"));
    const noHome = path.join(tmpRoot, "_no_home");

    const hosted = createHostedMediation({
      dbPath: ":memory:",
      mockEngine: false,
      projectRoot: tmpRoot,
      fsStoreOptions: { homeDir: noHome },
      pi: {
        inMemorySession: true,
        fsStoreOptions: { homeDir: noHome },
        projectRoot: tmpRoot,
        log: (level, msg, data) => {
          // eslint-disable-next-line no-console
          console.error(`[live-pw-hosted] ${level} ${msg}`, data ?? "");
        },
      },
      pollIntervalMs: 50,
      concurrency: 1,
      registerPlan: true,
      resolveDefinition: async (inp) => liveDef(inp.agentName, PKG_ROOT),
    });

    before(async () => {
      await hosted.worker.start();
    });

    after(async () => {
      await hosted.stop();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("L-W1: hosted parkIntent → wake default continue → Settled same sessionRef (bridge)", async () => {
      // File sessions required for durable resume (inMemory cannot rehydrate).
      const hRoot = path.join(tmpRoot, "lw1-file-root");
      fs.mkdirSync(hRoot, { recursive: true });
      const fileHosted = createHostedMediation({
        dbPath: ":memory:",
        mockEngine: false,
        projectRoot: tmpRoot,
        fsStoreOptions: { homeDir: noHome },
        pi: {
          inMemorySession: false,
          fsStoreOptions: { homeDir: noHome },
          projectRoot: tmpRoot,
          log: (level, msg, data) => {
            // eslint-disable-next-line no-console
            console.error(`[live-pw-lw1] ${level} ${msg}`, data ?? "");
          },
        },
        pollIntervalMs: 50,
        concurrency: 1,
        resolveDefinition: async (inp) => liveDef(inp.agentName, hRoot),
      });
      await fileHosted.worker.start();
      try {
        const t0 = Date.now();
        const handle = await fileHosted.mediation.dispatch({
          agent: { name: "live-lw1-park-wake", rootDir: hRoot },
          task: "ping",
          parkIntent: true,
          parkReason: "live-lw1-await",
          clientRequestId: `live-lw1-${Date.now()}`,
        });

        await pollJoinParked(
          () => fileHosted.mediation.getJoinByRunId(handle.runId),
          () => fileHosted.mediation.getStatus(handle.runId),
        );
        const parked = await fileHosted.mediation.getJoinByRunId(handle.runId);
        assert.equal(parked?.status, "parked");
        const sessionRef = parked!.sessionRef;
        assert.ok(
          fs.existsSync(String(sessionRef)),
          `file session must exist for resume: ${sessionRef}`,
        );
        // eslint-disable-next-line no-console
        console.error(
          `[live-pw-lw1] parked sessionRef=${sessionRef} ms=${Date.now() - t0}`,
        );

        // Pause so waitForSignal is armed (signals not buffered).
        await new Promise((r) => { setTimeout(r, 150); });

        // DEFAULT continue: omit mode. The arc appends the D1 ParkBridge
        // (whatWasAwaited = park reason, payload = "pong") as a user message
        // and engages — legal after the assistant-final settled park.
        await fileHosted.mediation.wake(handle.runId, {
          payloadText: "pong",
        });

        const status = await fileHosted.mediation.wait(handle.runId, {
          timeoutMs: WAIT_MS,
        });
        // eslint-disable-next-line no-console
        console.error(
          `[live-pw-lw1] after default-continue wake status=${JSON.stringify(status)} ms=${Date.now() - t0}`,
        );

        assert.equal(
          status.state,
          "completed",
          `expected completed, got ${JSON.stringify(status)}`,
        );
        const result = status.result as {
          kind?: string;
          sessionRef?: string;
          error?: { message?: string; code?: string };
        };
        assert.equal(
          result?.kind,
          "settled",
          `expected settled default-continue wake, got ${JSON.stringify(status)}`,
        );
        assert.equal(result?.sessionRef, sessionRef);

        const join = await fileHosted.mediation.getJoinByRunId(handle.runId);
        assert.equal(join?.status, "settled");
        assert.equal(join?.sessionRef, sessionRef);
      } finally {
        await fileHosted.stop();
      }
    });

    it("L-W2: local park → reenter default continue → Settled same sessionRef (bridge)", async () => {
      const agentDir = path.join(tmpRoot, "lw2-agent");
      writeLiveAgentYaml(agentDir, "live-lw2-reenter");

      const { mediation } = createLocalMediation({
        mockEngine: false,
        projectRoot: tmpRoot,
        fsStoreOptions: { homeDir: noHome },
        pi: {
          inMemorySession: false,
          fsStoreOptions: { homeDir: noHome },
          projectRoot: tmpRoot,
          log: (level, msg, data) => {
            // eslint-disable-next-line no-console
            console.error(`[live-pw-lw2] ${level} ${msg}`, data ?? "");
          },
        },
      });

      const t0 = Date.now();
      const parked = await mediation.engageLocal({
        agent: { name: "live-lw2-reenter", rootDir: agentDir },
        task: "ping",
        cwd: agentDir,
        parkIntent: true,
        parkReason: "live-lw2-await",
      });
      assert.equal(parked.outcome.kind, "parked");
      assert.ok(parked.sessionRef);
      assert.ok(
        fs.existsSync(String(parked.sessionRef)),
        `file session must exist: ${parked.sessionRef}`,
      );

      // Omit mode → reenter defaults to "continue"; the D1 bridge is built
      // from the join park reason (absent here → neutral wait contract) +
      // task, and continue routes through prompt after the assistant tail.
      const cont = await mediation.reenter({
        agent: { name: "live-lw2-reenter", rootDir: agentDir },
        sessionRef: parked.sessionRef!,
        task: "pong",
        cwd: agentDir,
        expectedPackSnapshotHash: parked.packSnapshotHash,
      });
      // eslint-disable-next-line no-console
      console.error(
        `[live-pw-lw2] parkedRef=${parked.sessionRef} reenterRef=${cont.sessionRef} outcome=${cont.outcome.kind} ms=${Date.now() - t0}`,
      );

      assert.equal(cont.packSnapshotMatch, true);
      assert.equal(
        cont.outcome.kind,
        "settled",
        `expected settled default-continue reenter, got ${JSON.stringify(cont.outcome)}`,
      );
      assert.equal(
        cont.sessionRef,
        parked.sessionRef,
        "file-backed reenter must preserve sessionRef",
      );
    });
  },
);
