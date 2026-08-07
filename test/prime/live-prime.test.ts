/**
 * Live observation: real prime-agent createAgentSession on the call path.
 *
 * Gated: MEDIATION_LIVE_PRIME=1
 * Default `npm run check` skips this (no keys required for CI).
 *
 * Human re-run:
 *   MEDIATION_LIVE_PRIME=1 npm test -- test/prime/live-prime.test.ts
 *
 * Requires: ~/.prime/agent/auth.json (fork config dir) with credentials for
 * the model. The fork built-in catalog covers common models (models.json
 * absent on this machine → built-in catalog).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { PrimeEngineAdapter } from "../../src/adapters/prime/engine-adapter.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";
import type { PackLoadPlan } from "../../src/domain/packs.ts";

const LIVE = process.env.MEDIATION_LIVE_PRIME === "1";
const HERE = import.meta.dirname;
const PKG_ROOT = path.resolve(HERE, "../..");

const emptyPlan: PackLoadPlan = {
  packs: [],
  diagnostics: [],
  ok: true,
};

function liveDefinition(rootDir: string): AgentDefinition {
  const model =
    process.env.MEDIATION_LIVE_MODEL ??
    process.env.PRIME_MODEL ??
    "deepseek/deepseek-v4-flash";
  return {
    id: "live-prime-s2b",
    name: "live-prime-s2b",
    rootDir,
    model,
    thinking: "off",
    prompt:
      "You are a minimal mediation live probe. Reply with exactly: pong",
    tools: { agentMode: "static", builtin: [] },
  };
}

describe("live Prime (MEDIATION_LIVE_PRIME=1)", { skip: !LIVE }, () => {
  it("openSession + prompt + waitUntilIdle + dispose via real createAgentSession", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-prime-live-"));
    const engine = new PrimeEngineAdapter({
      inMemorySession: true,
      log: (level, msg, data) => {
        // eslint-disable-next-line no-console
        console.error(`[live-prime] ${level} ${msg}`, data ?? "");
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
    console.error("[live-prime] sessionRef=", handle.sessionRef);

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
    console.error("[live-prime] idle=", idle, "trail=", trail.join(","));

    await handle.dispose();
    // eslint-disable-next-line no-console
    console.error("[live-prime] disposed ok");
  });
});
