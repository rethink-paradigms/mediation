/**
 * S5b live: runEngagementLeaf + createPiPresenceFactory on real Pi.
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
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { runEngagementLeaf } from "../../src/adapters/openworkflow/workflows/engagement.ts";
import { createPiPresenceFactory } from "../../src/adapters/wiring.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";
import { asRunId } from "../../src/domain/engagement.ts";

const LIVE = process.env.MEDIATION_LIVE_PI === "1";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "../..");

function liveDefinition(rootDir: string): AgentDefinition {
  const model =
    process.env.MEDIATION_LIVE_MODEL ??
    process.env.PI_MODEL ??
    "anthropic/claude-haiku-4-5-20251001";
  return {
    id: "live-s5b-leaf",
    name: "live-s5b-leaf",
    rootDir,
    model,
    thinking: "off",
    prompt:
      "You are a minimal mediation live leaf probe. Reply with exactly: pong",
    tools: { agentMode: "static", builtin: [] },
  };
}

describe("live engagement leaf + Pi (MEDIATION_LIVE_PI=1)", { skip: !LIVE }, () => {
  it("runEngagementLeaf → Settled with real Pi factory", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s5b-live-"));
    const { factory, engine } = createPiPresenceFactory({
      inMemorySession: true,
      packResolverOptions: { homeDir: path.join(tmp, "_no_home") },
      projectRoot: tmp,
      log: (level, msg, data) => {
        // eslint-disable-next-line no-console
        console.error(`[live-leaf-pi] ${level} ${msg}`, data ?? "");
      },
    });
    const join = new MemoryJoinStore();
    const runId = asRunId("run-s5b-live-1");

    // definition root is tmp; cwd for tools/session stays package root if needed
    const def = liveDefinition(tmp);
    // materialize uses cwd from leaf input.agentRoot — use PKG_ROOT so Pi can resolve
    const output = await runEngagementLeaf(
      {
        agentName: def.name,
        agentRoot: PKG_ROOT,
        task: "ping",
        requestId: "req-s5b-live",
      },
      {
        factory,
        join,
        runId,
        resolveDefinition: async () => ({
          ...def,
          rootDir: PKG_ROOT,
        }),
      },
    );

    // eslint-disable-next-line no-console
    console.error("[live-leaf-pi] output=", JSON.stringify(output, null, 2));

    assert.equal(output.kind, "settled", `expected settled, got ${output.kind}`);
    if (output.kind === "settled") {
      assert.ok(output.sessionRef, "sessionRef present");
      assert.equal(typeof output.packSnapshotHash, "string");
    }
    assert.equal(engine.opened.length, 1);

    const record = await join.getByRunId(runId);
    assert.ok(record);
    assert.equal(record.status, "settled");
    assert.equal(record.sessionRef, (output as { sessionRef: string }).sessionRef);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
