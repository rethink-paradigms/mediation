/**
 * S2c live: createPiPresenceFactory → materialize → engage → Settled on real Pi.
 *
 * Gated: MEDIATION_LIVE_PI=1
 * Default `npm run check` skips this (no keys required for CI).
 *
 * Human re-run:
 *   MEDIATION_LIVE_PI=1 node --experimental-strip-types --test test/integration/live-pi-factory.test.ts
 *
 * Requires: ~/.pi/agent/auth.json (or PI auth) with credentials for the model.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

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
    id: "live-s2c",
    name: "live-s2c",
    rootDir,
    model,
    thinking: "off",
    prompt:
      "You are a minimal mediation live probe. Reply with exactly: pong",
    // empty extensions → pack plan ok without fixture packs
    tools: { agentMode: "static", builtin: [] },
  };
}

describe("live Pi factory (MEDIATION_LIVE_PI=1)", { skip: !LIVE }, () => {
  it("createPiPresenceFactory materialize + engage → Settled", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s2c-live-"));
    const { factory, engine } = createPiPresenceFactory({
      inMemorySession: true,
      fsStoreOptions: { homeDir: path.join(tmp, "_no_home") },
      projectRoot: tmp,
      log: (level, msg, data) => {
        // eslint-disable-next-line no-console
        console.error(`[live-pi-factory] ${level} ${msg}`, data ?? "");
      },
    });

    const definition = liveDefinition(tmp);
    const presence = await factory.materialize(definition, { cwd: PKG_ROOT });

    assert.ok(presence.sessionRef, "sessionRef assigned");
    assert.equal(presence.status, "idle");
    assert.equal(engine.opened.length, 1);
    // eslint-disable-next-line no-console
    console.error("[live-pi-factory] sessionRef=", presence.sessionRef);

    const trail: string[] = [];
    presence.observe((e) => {
      if (e.type === "status") trail.push(`status:${e.status}`);
      else if (e.type === "idle") trail.push(`idle`);
      else if (e.type === "message") trail.push(`msg:${e.role}`);
      else if (e.type === "error") trail.push(`error:${e.message}`);
      else trail.push(e.type);
    });

    const outcome = await presence.engage({ text: "ping" });

    // eslint-disable-next-line no-console
    console.error(
      "[live-pi-factory] outcome=",
      outcome,
      "trail=",
      trail.join(","),
    );

    assert.equal(
      outcome.kind,
      "settled",
      `expected settled, got ${JSON.stringify(outcome)}`,
    );
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, presence.sessionRef);
    }
    assert.equal(presence.status, "idle");
    assert.ok(
      trail.includes("status:engaging"),
      `expected engaging in trail: ${trail.join(",")}`,
    );

    await presence.dispose();
    assert.equal(presence.status, "disposed");
    // eslint-disable-next-line no-console
    console.error("[live-pi-factory] disposed ok");
  });
});
