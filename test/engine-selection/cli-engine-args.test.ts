/**
 * S2e CLI: --engine flag + MEDIATION_CLI_ENGINE env + legacy MEDIATION_CLI_PI.
 * Precedence: --engine > MEDIATION_CLI_ENGINE > MEDIATION_CLI_PI=1 ("pi") >
 * definition/config > CLI smoke default "mock". Unknown engine → exit 2.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseArgs, printHelp, runCli } from "../../src/surfaces/cli.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type { SurfacePort } from "../../src/ports/surface.ts";

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("MEDIATION_CLI_")) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

/** Surface that records the engine override it receives. */
function recordingSurface(): { surface: SurfacePort; engines: Array<string | undefined> } {
  const engines: Array<string | undefined> = [];
  const surface: SurfacePort = {
    async engageLocal(req) {
      engines.push(req.engine);
      return {
        outcome: { kind: "settled", sessionRef: asSessionRef("cli-sess") },
        sessionRef: asSessionRef("cli-sess"),
        packSnapshotHash: "0".repeat(64),
        definitionId: "cli-agent",
      };
    },
  };
  return { surface, engines };
}

const AGENT_ARGS = [
  "engage",
  "--agent",
  "/tmp/cli-agent",
  "--task",
  "hello",
  "--name",
  "cli-agent",
];

describe("CLI --engine parsing (S2e)", () => {
  it("parseArgs extracts --engine", () => {
    const p = parseArgs(["engage", "--agent", "/tmp/a", "--task", "t", "--engine", "prime"]);
    assert.equal(p.engine, "prime");
    assert.equal(p.command, "engage");
  });

  it("parseArgs without --engine leaves engine undefined", () => {
    const p = parseArgs(["engage", "--agent", "/tmp/a", "--task", "t"]);
    assert.equal(p.engine, undefined);
  });

  it("--engine flag wins over MEDIATION_CLI_ENGINE env", async () => {
    resetEnv();
    process.env.MEDIATION_CLI_ENGINE = "prime";
    const { surface, engines } = recordingSurface();
    const code = await runCli([...AGENT_ARGS, "--engine", "pi"], { surface });
    assert.equal(code, 0);
    assert.deepEqual(engines, ["pi"]);
  });

  it("MEDIATION_CLI_ENGINE env applies when no flag", async () => {
    resetEnv();
    process.env.MEDIATION_CLI_ENGINE = "prime";
    const { surface, engines } = recordingSurface();
    const code = await runCli(AGENT_ARGS, { surface });
    assert.equal(code, 0);
    assert.deepEqual(engines, ["prime"]);
  });

  it("legacy MEDIATION_CLI_PI=1 alone leaves the override unset (composition default pi)", async () => {
    resetEnv();
    process.env.MEDIATION_CLI_PI = "1";
    const { surface, engines } = recordingSurface();
    const code = await runCli(AGENT_ARGS, { surface });
    assert.equal(code, 0);
    assert.deepEqual(engines, [undefined]);
  });

  it("unknown --engine → exit 2 (help printed, fail-closed)", async () => {
    resetEnv();
    const { surface } = recordingSurface();
    const code = await runCli([...AGENT_ARGS, "--engine", "bogus"], { surface });
    assert.equal(code, 2);
  });

  it("unknown MEDIATION_CLI_ENGINE → exit 2 (fail-closed)", async () => {
    resetEnv();
    process.env.MEDIATION_CLI_ENGINE = "bogus";
    const { surface } = recordingSurface();
    const code = await runCli(AGENT_ARGS, { surface });
    assert.equal(code, 2);
  });

  it("no flags/env → no override (CLI smoke default mock preserved downstream)", async () => {
    resetEnv();
    const { surface, engines } = recordingSurface();
    const code = await runCli(AGENT_ARGS, { surface });
    assert.equal(code, 0);
    assert.deepEqual(engines, [undefined]);
  });

  it("printHelp documents --engine and both env vars", () => {
    const help = printHelp();
    assert.match(help, /--engine/u);
    assert.match(help, /MEDIATION_CLI_ENGINE/u);
    assert.match(help, /MEDIATION_CLI_PI/u);
  });
});
