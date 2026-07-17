/**
 * Live observation: real createAgentSession / Pi on the call path.
 *
 * Gated: MEDIATION_LIVE_PI=1
 * Default `npm run check` skips this (no keys required for CI).
 *
 * Human re-run:
 *   MEDIATION_LIVE_PI=1 npm test -- test/pi/live-pi.test.ts
 *
 * Requires: ~/.pi/agent/auth.json (or PI auth) with credentials for the model.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PiEngineAdapter } from "../../src/adapters/pi/engine-adapter.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";
import type { PackLoadPlan } from "../../src/domain/packs.ts";

const LIVE = process.env.MEDIATION_LIVE_PI === "1";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "../..");

const emptyPlan: PackLoadPlan = {
  packs: [],
  diagnostics: [],
  ok: true,
};

function liveDefinition(rootDir: string): AgentDefinition {
  const model =
    process.env.MEDIATION_LIVE_MODEL ??
    process.env.PI_MODEL ??
    "deepseek/deepseek-v4-flash";
  return {
    id: "live-s2b",
    name: "live-s2b",
    rootDir,
    model,
    thinking: "off",
    prompt:
      "You are a minimal mediation live probe. Reply with exactly: pong",
    tools: { agentMode: "static", builtin: [] },
  };
}

describe("live Pi (MEDIATION_LIVE_PI=1)", { skip: !LIVE }, () => {
  it("openSession + prompt + waitUntilIdle + dispose via real createAgentSession", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s2b-live-"));
    const engine = new PiEngineAdapter({
      inMemorySession: true,
      log: (level, msg, data) => {
        // eslint-disable-next-line no-console
        console.error(`[live-pi] ${level} ${msg}`, data ?? "");
      },
    });

    const definition = liveDefinition(tmp);
    const handle = await engine.openSession({
      definition,
      packPlan: emptyPlan,
      cwd: PKG_ROOT,
      settings: { inMemory: true, thinking: "off" },
      tools: { agentMode: "static", builtin: [] },
    });

    assert.ok(handle.sessionRef, "sessionRef assigned");
    // eslint-disable-next-line no-console
    console.error("[live-pi] sessionRef=", handle.sessionRef);

    const trail: string[] = [];
    handle.subscribe((e) => {
      if (e.type === "idle") trail.push(`idle:${e.snapshot.reason}`);
      else if (e.type === "message") trail.push(`msg:${e.role}`);
      else if (e.type === "raw") trail.push(`raw:${e.name}`);
      else trail.push(e.type);
    });

    await handle.prompt("ping");
    const idle = await handle.waitUntilIdle({
      signal: AbortSignal.timeout(120_000),
    });

    assert.ok(idle.at, "idle snapshot has timestamp");
    // eslint-disable-next-line no-console
    console.error("[live-pi] idle=", idle, "trail=", trail.join(","));

    await handle.dispose();
    // eslint-disable-next-line no-console
    console.error("[live-pi] disposed ok");
  });
});
