/**
 * Live system health — product doors with real Pi + DeepSeek.
 *
 * Gated: MEDIATION_LIVE_PI=1
 * Default `npm run check` skips this (no keys required for CI).
 *
 *   MEDIATION_LIVE_PI=1 MEDIATION_LIVE_MODEL=deepseek/deepseek-v4-flash \
 *     npm run test:live-pi
 *
 * Requires: ~/.pi/agent/auth.json with credentials for the model.
 *
 * Scenario matrix (outcomes, not architecture purity):
 *   H1  engageLocal Settled (createLocalMediation + real Pi)
 *   H2  hosted Mediation.dispatch → wait Settled
 *   H3  engageLocal parkIntent → Parked (explicit park after real mind idle)
 *   H4  hosted park → wake mode=prompt → Settled same sessionRef (file session)
 *   H4b hosted park → wake default continue → Settled same sessionRef (D1
 *       ParkBridge: append whatWasAwaited + payload, then engage — issue #1)
 *   H5  fail-closed missing capability (no openSession / failed leaf)
 *   H6  park local → reenter mode=prompt same sessionRef (file session)
 *   H6b inMemory reenter continue fails (no resume path)
 *   H7  runPlan two short nodes → completed
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
    prompt: `You are a minimal mediation live health probe. ${promptExtra}`,
    tools: { agentMode: "static", builtin: [] },
  };
}

function writeLiveAgentYaml(
  dir: string,
  name: string,
  opts?: { extensions?: string[] },
): void {
  fs.mkdirSync(dir, { recursive: true });
  const extensions =
    opts?.extensions && opts.extensions.length > 0
      ? `extensions:\n${opts.extensions.map((e) => `  - ${e}`).join("\n")}\n`
      : "";
  fs.writeFileSync(
    path.join(dir, "agent.yaml"),
    `name: ${name}
model: ${LIVE_MODEL}
thinking: off
${extensions}prompt: |
  You are a minimal mediation live health probe. Reply with exactly: pong
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
    if (st.state === "completed" || st.state === "failed" || st.state === "canceled") {
      throw new Error(`run left open continuum early: ${JSON.stringify(st)}`);
    }
    const j = await get();
    if (j?.status === "parked") return;
    await new Promise((r) => { setTimeout(r, 50); });
  }
  throw new Error("timeout waiting for join parked");
}

describe(
  "live life health (MEDIATION_LIVE_PI=1)",
  { skip: !LIVE },
  () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-live-health-"));
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
          console.error(`[live-health-hosted] ${level} ${msg}`, data ?? "");
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

    it("H1: engageLocal Settled via createLocalMediation + real Pi", async () => {
      const agentDir = path.join(tmpRoot, "h1-agent");
      writeLiveAgentYaml(agentDir, "live-h1-local");

      const { mediation } = createLocalMediation({
        mockEngine: false,
        projectRoot: tmpRoot,
        fsStoreOptions: { homeDir: noHome },
        pi: {
          inMemorySession: true,
          fsStoreOptions: { homeDir: noHome },
          projectRoot: tmpRoot,
          log: (level, msg, data) => {
            // eslint-disable-next-line no-console
            console.error(`[live-health-h1] ${level} ${msg}`, data ?? "");
          },
        },
      });

      const t0 = Date.now();
      const result = await mediation.engageLocal({
        agent: { name: "live-h1-local", rootDir: agentDir },
        task: "ping",
        cwd: PKG_ROOT,
      });
      // eslint-disable-next-line no-console
      console.error(
        `[live-health-h1] outcome=${result.outcome.kind} sessionRef=${result.sessionRef} ms=${Date.now() - t0}`,
      );

      assert.equal(
        result.outcome.kind,
        "settled",
        `expected settled, got ${JSON.stringify(result.outcome)}`,
      );
      assert.ok(result.sessionRef, "sessionRef present");
      assert.equal(typeof result.packSnapshotHash, "string");
    });

    it("H2: hosted Mediation.dispatch → wait Settled + join correlation", async () => {
      const t0 = Date.now();
      const handle = await hosted.mediation.dispatch({
        agent: { name: "live-h2-hosted", rootDir: PKG_ROOT },
        task: "ping",
        clientRequestId: `live-h2-${Date.now()}`,
      });
      const status = await hosted.mediation.wait(handle.runId, {
        timeoutMs: WAIT_MS,
      });
      // eslint-disable-next-line no-console
      console.error(
        `[live-health-h2] status=${JSON.stringify(status)} ms=${Date.now() - t0}`,
      );

      assert.equal(status.state, "completed");
      const result = status.result as {
        kind?: string;
        sessionRef?: string;
        packSnapshotHash?: string;
      };
      assert.equal(result?.kind, "settled");
      assert.ok(result?.sessionRef);

      const join = await hosted.mediation.getJoinByRunId(handle.runId);
      assert.ok(join, "join row");
      assert.equal(join.status, "settled");
      assert.equal(join.sessionRef, result.sessionRef);
      assert.equal(join.packSnapshot.planHash, result.packSnapshotHash);
    });

    it("H3: engageLocal parkIntent → Parked after real mind idle", async () => {
      const agentDir = path.join(tmpRoot, "h3-agent");
      writeLiveAgentYaml(agentDir, "live-h3-park");

      const { mediation } = createLocalMediation({
        mockEngine: false,
        projectRoot: tmpRoot,
        fsStoreOptions: { homeDir: noHome },
        pi: {
          inMemorySession: true,
          fsStoreOptions: { homeDir: noHome },
          projectRoot: tmpRoot,
          log: (level, msg, data) => {
            // eslint-disable-next-line no-console
            console.error(`[live-health-h3] ${level} ${msg}`, data ?? "");
          },
        },
      });

      const t0 = Date.now();
      const result = await mediation.engageLocal({
        agent: { name: "live-h3-park", rootDir: agentDir },
        task: "ping",
        cwd: PKG_ROOT,
        parkIntent: true,
        parkReason: "live-health-need-human",
      });
      // eslint-disable-next-line no-console
      console.error(
        `[live-health-h3] outcome=${JSON.stringify(result.outcome)} ms=${Date.now() - t0}`,
      );

      assert.equal(result.outcome.kind, "parked");
      if (result.outcome.kind === "parked") {
        assert.equal(result.outcome.reason, "live-health-need-human");
        assert.ok(result.outcome.resumeToken);
      }
      assert.ok(result.sessionRef);
    });

    it("H4: hosted parkIntent → wake mode=prompt → Settled same sessionRef (file session)", async () => {
      // inMemorySession cannot resume: continue fails with "No messages to continue from".
      // File-backed sessions are required for park → wake continuum fidelity.
      const h4Root = path.join(tmpRoot, "h4-file-root");
      fs.mkdirSync(h4Root, { recursive: true });
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
            console.error(`[live-health-h4] ${level} ${msg}`, data ?? "");
          },
        },
        pollIntervalMs: 50,
        concurrency: 1,
        resolveDefinition: async (inp) => liveDef(inp.agentName, h4Root),
      });
      await fileHosted.worker.start();
      try {
        const t0 = Date.now();
        const handle = await fileHosted.mediation.dispatch({
          agent: { name: "live-h4-park-wake", rootDir: h4Root },
          task: "ping",
          parkIntent: true,
          parkReason: "live-h4-await",
          clientRequestId: `live-h4-${Date.now()}`,
        });

        await pollJoinParked(
          () => fileHosted.mediation.getJoinByRunId(handle.runId),
          () => fileHosted.mediation.getStatus(handle.runId),
        );
        const mid = await fileHosted.mediation.getStatus(handle.runId);
        assert.notEqual(mid.state, "completed");
        const parked = await fileHosted.mediation.getJoinByRunId(handle.runId);
        assert.equal(parked?.status, "parked");
        const sessionRef = parked!.sessionRef;
        assert.ok(
          fs.existsSync(String(sessionRef)),
          `file session must exist for resume: ${sessionRef}`,
        );
        // eslint-disable-next-line no-console
        console.error(
          `[live-health-h4] parked sessionRef=${sessionRef} midState=${mid.state} ms=${Date.now() - t0}`,
        );

        // Pause so waitForSignal is armed (signals not buffered).
        await new Promise((r) => { setTimeout(r, 150); });

        // Explicit prompt mode: payload is the next user turn (no bridge).
        // H4b covers the default continue path via the D1 ParkBridge.
        await fileHosted.mediation.wake(handle.runId, {
          payloadText: "pong",
          mode: "prompt",
        });

        const status = await fileHosted.mediation.wait(handle.runId, {
          timeoutMs: WAIT_MS,
        });
        // eslint-disable-next-line no-console
        console.error(
          `[live-health-h4] after wake status=${JSON.stringify(status)} ms=${Date.now() - t0}`,
        );

        assert.equal(status.state, "completed");
        const result = status.result as { kind?: string; sessionRef?: string };
        assert.equal(
          result?.kind,
          "settled",
          `expected settled after wake, got ${JSON.stringify(status)}`,
        );
        assert.equal(result?.sessionRef, sessionRef);

        const join = await fileHosted.mediation.getJoinByRunId(handle.runId);
        assert.equal(join?.status, "settled");
        assert.equal(join?.sessionRef, sessionRef);
      } finally {
        await fileHosted.stop();
      }
    });

    it("H4b: wake default continue after settled park → Settled same sessionRef (bridge)", async () => {
      const h4Root = path.join(tmpRoot, "h4b-file-root");
      fs.mkdirSync(h4Root, { recursive: true });
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
            console.error(`[live-health-h4b] ${level} ${msg}`, data ?? "");
          },
        },
        pollIntervalMs: 50,
        concurrency: 1,
        resolveDefinition: async (inp) => liveDef(inp.agentName, h4Root),
      });
      await fileHosted.worker.start();
      try {
        const handle = await fileHosted.mediation.dispatch({
          agent: { name: "live-h4b-cont", rootDir: h4Root },
          task: "ping",
          parkIntent: true,
          parkReason: "live-h4b-await",
          clientRequestId: `live-h4b-${Date.now()}`,
        });
        await pollJoinParked(
          () => fileHosted.mediation.getJoinByRunId(handle.runId),
          () => fileHosted.mediation.getStatus(handle.runId),
        );
        const parkedJoin = await fileHosted.mediation.getJoinByRunId(handle.runId);
        assert.equal(parkedJoin?.status, "parked");
        const sessionRef = parkedJoin!.sessionRef;
        assert.ok(
          fs.existsSync(String(sessionRef)),
          `file session must exist for resume: ${sessionRef}`,
        );
        await new Promise((r) => { setTimeout(r, 150); });
        // Omit mode → engagement-arc defaults wake.mode to "continue"; the
        // D1 ParkBridge (issue #1) appends whatWasAwaited + payload as a user
        // message so continue is legal after the assistant-final settled park.
        await fileHosted.mediation.wake(handle.runId, {
          payloadText: "pong",
        });
        const status = await fileHosted.mediation.wait(handle.runId, {
          timeoutMs: WAIT_MS,
        });
        // eslint-disable-next-line no-console
        console.error(
          `[live-health-h4b] default-continue wake status=${JSON.stringify(status)}`,
        );
        assert.equal(status.state, "completed");
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

    it("H5: fail-closed missing capability → completed failed leaf (no openSession)", async () => {
      // Isolated hosted composition so resolveDefinition can inject bad packs.
      const badHosted = createHostedMediation({
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
            console.error(`[live-health-h5] ${level} ${msg}`, data ?? "");
          },
        },
        pollIntervalMs: 50,
        concurrency: 1,
        resolveDefinition: async (inp) => ({
          ...liveDef(inp.agentName, PKG_ROOT),
          extensions: ["totally-missing-capability-xyz"],
        }),
      });
      await badHosted.worker.start();
      try {
        const t0 = Date.now();
        const handle = await badHosted.mediation.dispatch({
          agent: { name: "live-bad-packs", rootDir: PKG_ROOT },
          task: "should not run mind",
          clientRequestId: `live-h5-${Date.now()}`,
        });
        const status = await badHosted.mediation.wait(handle.runId, {
          timeoutMs: 30_000,
        });
        // eslint-disable-next-line no-console
        console.error(
          `[live-health-h5] status=${JSON.stringify(status)} ms=${Date.now() - t0}`,
        );

        assert.equal(status.state, "completed");
        const result = status.result as {
          kind?: string;
          error?: { code?: string };
        };
        assert.equal(result?.kind, "failed");
        assert.equal(result?.error?.code, "CAPABILITY_RESOLVE_FAILED");
      } finally {
        await badHosted.stop();
      }
    });

    it("H6: park local → reenter mode=prompt same sessionRef (file session)", async () => {
      // File session required: inMemory resume falls back to empty session and
      // continue fails with "No messages to continue from".
      const agentDir = path.join(tmpRoot, "h6-agent");
      writeLiveAgentYaml(agentDir, "live-h6-reenter");

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
            console.error(`[live-health-h6] ${level} ${msg}`, data ?? "");
          },
        },
      });

      const t0 = Date.now();
      const parked = await mediation.engageLocal({
        agent: { name: "live-h6-reenter", rootDir: agentDir },
        task: "ping",
        cwd: agentDir,
        parkIntent: true,
        parkReason: "live-h6-park",
      });
      assert.equal(parked.outcome.kind, "parked");
      assert.ok(parked.sessionRef);
      assert.ok(parked.packSnapshotHash);
      assert.ok(
        fs.existsSync(String(parked.sessionRef)),
        `file session must exist: ${parked.sessionRef}`,
      );

      // mode prompt: next user turn on resumed file session (continue fails after assistant).
      const cont = await mediation.reenter({
        agent: { name: "live-h6-reenter", rootDir: agentDir },
        sessionRef: parked.sessionRef!,
        task: "pong",
        cwd: agentDir,
        expectedPackSnapshotHash: parked.packSnapshotHash,
        mode: "prompt",
      });
      // eslint-disable-next-line no-console
      console.error(
        `[live-health-h6] parkedRef=${parked.sessionRef} reenterRef=${cont.sessionRef} packMatch=${cont.packSnapshotMatch} outcome=${cont.outcome.kind} ms=${Date.now() - t0}`,
      );

      assert.equal(cont.packSnapshotMatch, true);
      assert.equal(
        cont.outcome.kind,
        "settled",
        `expected settled reenter, got ${JSON.stringify(cont.outcome)}`,
      );
      assert.equal(
        cont.sessionRef,
        parked.sessionRef,
        "file-backed reenter must preserve sessionRef",
      );
    });

    it("H6b: inMemory park → reenter continue fails closed (documented gap)", async () => {
      // Proves the inMemory continuum limitation observed in investigation.
      const agentDir = path.join(tmpRoot, "h6b-agent");
      writeLiveAgentYaml(agentDir, "live-h6b-inmem");

      const { mediation } = createLocalMediation({
        mockEngine: false,
        projectRoot: tmpRoot,
        fsStoreOptions: { homeDir: noHome },
        pi: {
          inMemorySession: true,
          fsStoreOptions: { homeDir: noHome },
          projectRoot: tmpRoot,
          log: (level, msg, data) => {
            // eslint-disable-next-line no-console
            console.error(`[live-health-h6b] ${level} ${msg}`, data ?? "");
          },
        },
      });

      const parked = await mediation.engageLocal({
        agent: { name: "live-h6b-inmem", rootDir: agentDir },
        task: "ping",
        cwd: PKG_ROOT,
        parkIntent: true,
      });
      assert.equal(parked.outcome.kind, "parked");

      const cont = await mediation.reenter({
        agent: { name: "live-h6b-inmem", rootDir: agentDir },
        sessionRef: parked.sessionRef!,
        task: "pong",
        cwd: PKG_ROOT,
        mode: "continue",
      });
      // eslint-disable-next-line no-console
      console.error(
        `[live-health-h6b] reenter under inMemory: ${JSON.stringify(cont.outcome)}`,
      );
      assert.equal(cont.outcome.kind, "failed");
      if (cont.outcome.kind === "failed") {
        assert.match(
          cont.outcome.error.message,
          /No messages to continue from/iu,
        );
      }
      assert.notEqual(cont.sessionRef, parked.sessionRef);
    });

    it("H7: runPlan two short nodes → completed", async () => {
      const t0 = Date.now();
      const handle = await hosted.mediation.runPlan({
        id: `live-plan-${Date.now()}`,
        nodes: [
          {
            id: "n1",
            agent: { name: "live-h7-a", rootDir: PKG_ROOT },
            task: "ping",
          },
          {
            id: "n2",
            agent: { name: "live-h7-b", rootDir: PKG_ROOT },
            task: "ping",
          },
        ],
      });
      const status = await hosted.mediation.wait(handle.runId, {
        timeoutMs: WAIT_MS * 2,
      });
      // eslint-disable-next-line no-console
      console.error(
        `[live-health-h7] status=${JSON.stringify(status)} ms=${Date.now() - t0}`,
      );

      assert.equal(status.state, "completed");
      const result = status.result as {
        kind?: string;
        nodes?: Array<{
          nodeId?: string;
          outcome?: { kind?: string };
        }>;
      };
      assert.equal(result?.kind, "completed");
      assert.equal(result?.nodes?.length, 2);
      for (const n of result?.nodes ?? []) {
        assert.equal(
          n.outcome?.kind,
          "settled",
          `node ${n.nodeId} expected settled, got ${JSON.stringify(n)}`,
        );
      }
    });
  },
);
