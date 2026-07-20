/**
 * S5d live: OW worker + createPiPresenceFactory on real Pi.
 *
 * Gated: MEDIATION_LIVE_PI=1
 * Default `npm run check` skips this.
 *
 *   MEDIATION_LIVE_PI=1 npm run test:live-pi
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { OpenWorkflowRuntime } from "../../src/adapters/openworkflow/runtime.ts";
import { registerEngagementWorkflow } from "../../src/adapters/openworkflow/register-engagement.ts";
import { createPiPresenceFactory } from "../../src/adapters/wiring.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";

const LIVE = process.env.MEDIATION_LIVE_PI === "1";
const HERE = import.meta.dirname;
const PKG_ROOT = path.resolve(HERE, "../..");

function liveDefinition(rootDir: string): AgentDefinition {
  const model =
    process.env.MEDIATION_LIVE_MODEL ??
    process.env.PI_MODEL ??
    "deepseek/deepseek-v4-flash";
  return {
    id: "live-s5d-worker",
    name: "live-s5d-worker",
    rootDir,
    model,
    thinking: "off",
    prompt:
      "You are a minimal mediation live worker probe. Reply with exactly: pong",
    tools: { agentMode: "static", builtin: [] },
  };
}

describe(
  "live OW worker + Pi factory (MEDIATION_LIVE_PI=1)",
  { skip: !LIVE },
  () => {
    const backend = BackendSqlite.connect(":memory:");
    const ow = new OpenWorkflow({ backend });
    const join = new MemoryJoinStore();
    let workerStarted = false;
    let worker: { start(): Promise<void>; stop(): Promise<void> } | undefined;

    after(async () => {
      if (workerStarted && worker) {
        await worker.stop();
      }
      await backend.stop();
    });

    it("dispatch → worker → Settled with real Pi factory", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s5d-live-"));
      const { factory, engine } = createPiPresenceFactory({
        inMemorySession: true,
        fsStoreOptions: { homeDir: path.join(tmp, "_no_home") },
        projectRoot: tmp,
        log: (level, msg, data) => {
          // eslint-disable-next-line no-console
          console.error(`[live-worker-pi] ${level} ${msg}`, data ?? "");
        },
      });

      const def = liveDefinition(PKG_ROOT);
      const { engagementSpec } = registerEngagementWorkflow(ow, {
        factory,
        join,
        resolveDefinition: async () => def,
      });

      const runtime = new OpenWorkflowRuntime({
        ow,
        backend: {
          getWorkflowRun: (params) => backend.getWorkflowRun(params),
        },
        engagementSpec,
        pollIntervalMs: 50,
      });

      worker = ow.newWorker({ concurrency: 1 });
      await worker.start();
      workerStarted = true;

      const handle = await runtime.dispatch({
        agent: { name: def.name, rootDir: PKG_ROOT },
        task: "ping",
        clientRequestId: "s5d-live-1",
      });

      const status = await runtime.wait(handle.runId, { timeoutMs: 120_000 });
      // eslint-disable-next-line no-console
      console.error(
        "[live-worker-pi] status=",
        JSON.stringify(status, null, 2),
      );

      assert.equal(status.state, "completed");
      const result = status.result as {
        kind?: string;
        sessionRef?: string;
        packSnapshotHash?: string;
      };
      assert.equal(result?.kind, "settled");
      assert.ok(result?.sessionRef, "sessionRef present");
      assert.equal(engine.opened.length, 1);

      const record = await join.getByRunId(handle.runId);
      assert.ok(record);
      assert.equal(record.status, "settled");
      assert.equal(record.sessionRef, result.sessionRef);

      fs.rmSync(tmp, { recursive: true, force: true });
    });
  },
);
