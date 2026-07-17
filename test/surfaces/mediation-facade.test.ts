/**
 * S7: Mediation façade + CLI smoke (mock mind).
 * ABS-B2: CLI via SurfacePort (createMediationSurface).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createYamlDefinitionLoader } from "../../src/adapters/definition/yaml-definition-loader.ts";
import { createLocalMediation } from "../../src/adapters/compose.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../../src/adapters/packs/resolve-packs.ts";
import { createMediationSurface } from "../../src/adapters/surface/mediation-surface.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { parseArgs, printHelp, runCli } from "../../src/surfaces/cli.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEF_FIXTURE = path.resolve(HERE, "../../fixtures/definition/case-basic");
const PACK_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

describe("Mediation façade (S7)", () => {
  it("engageLocal → Settled; resume keeps sessionRef", async () => {
    const factory = new DefaultPresenceFactory({
      engine: new MockEnginePort({
        sessionRefFactory: () => asSessionRef("facade-sess"),
      }),
      toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: PACK_ROOT,
        homeDir: path.join(PACK_ROOT, "_no_home"),
      }),
    ),
    });

    const loader = {
      load: async (ref: { name: string; rootDir: string }) =>
        agentDefForPacks(ref.rootDir, ["foo", "bar"], ref.name),
    };

    const { join } = createLocalMediation({ mockEngine: true });
    const façade = new Mediation({ loader, factory, join });

    const result = await façade.engageLocal({
      agent: { name: "facade-agent", rootDir: PACK_ROOT },
      task: "hello façade",
    });

    assert.equal(result.outcome.kind, "settled");
    assert.equal(result.sessionRef, "facade-sess");
    assert.equal(typeof result.packSnapshotHash, "string");
    assert.equal(result.definitionId, "facade-agent");

    const resumed = await façade.engageLocal({
      agent: { name: "facade-agent", rootDir: PACK_ROOT },
      task: "again",
      resume: asSessionRef("facade-sess"),
    });
    assert.equal(resumed.outcome.kind, "settled");
    assert.equal(resumed.sessionRef, "facade-sess");
  });

  it("yaml load via createLocalMediation", async () => {
    const { mediation } = createLocalMediation({
      mockEngine: true,
      projectRoot: DEF_FIXTURE,
    });
    const def = await mediation.load({
      name: "case-basic",
      rootDir: DEF_FIXTURE,
    });
    assert.equal(def.name, "case-basic");
    assert.ok((def.prompt ?? "").length > 0);
  });

  it("dispatch without runtime throws", async () => {
    const { mediation } = createLocalMediation({ mockEngine: true });
    await assert.rejects(
      () =>
        mediation.dispatch({
          agent: { name: "x", rootDir: "/tmp" },
          task: "nope",
        }),
      /no RuntimePort/,
    );
  });

  it("createYamlDefinitionLoader still golden on fixture", async () => {
    const loader = createYamlDefinitionLoader();
    const def = await loader.load({
      name: "case-basic",
      rootDir: DEF_FIXTURE,
    });
    assert.equal(def.name, "case-basic");
  });
});

describe("CLI parse / help / smoke (S7 / ABS-B2)", () => {
  it("parseArgs extracts engage flags", () => {
    const p = parseArgs([
      "engage",
      "--agent",
      "/tmp/agent",
      "--task",
      "hi",
      "--resume",
      "sess-1",
      "--name",
      "my-agent",
      "--project-root",
      "/tmp/project",
    ]);
    assert.equal(p.command, "engage");
    assert.equal(p.agentDir, "/tmp/agent");
    assert.equal(p.task, "hi");
    assert.equal(p.resume, "sess-1");
    assert.equal(p.name, "my-agent");
    assert.equal(p.projectRoot, "/tmp/project");
  });

  it("printHelp is non-empty", () => {
    assert.ok(printHelp().includes("engage"));
  });

  it("runCli engage settles with mock mind", async () => {
    const nested = path.join(PACK_ROOT, "_cli_agent_s7");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "agent.yaml"),
      `name: cli-s7
model: test/model
thinking: off
extensions:
  - foo
prompt: |
  You are a test agent.
`,
      "utf8",
    );

    const code = await runCli([
      "engage",
      "--agent",
      nested,
      "--task",
      "cli smoke",
      "--name",
      "cli-s7",
      "--project-root",
      PACK_ROOT,
    ]);
    assert.equal(code, 0);

    fs.rmSync(nested, { recursive: true, force: true });
  });

  it("runCli missing args exits 2", async () => {
    const code = await runCli(["engage"]);
    assert.equal(code, 2);
  });
});

describe("createMediationSurface (ABS-B2)", () => {
  it("wraps Mediation.engageLocal as SurfacePort", async () => {
    const factory = new DefaultPresenceFactory({
      engine: new MockEnginePort({
        sessionRefFactory: () => asSessionRef("surface-sess"),
      }),
      toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: PACK_ROOT,
        homeDir: path.join(PACK_ROOT, "_no_home"),
      }),
    ),
    });
    const loader = {
      load: async (ref: { name: string; rootDir: string }) =>
        agentDefForPacks(ref.rootDir, ["foo", "bar"], ref.name),
    };
    const { join } = createLocalMediation({ mockEngine: true });
    const mediation = new Mediation({ loader, factory, join });
    const surface = createMediationSurface(mediation);

    const result = await surface.engageLocal({
      agent: { name: "surface-agent", rootDir: PACK_ROOT },
      task: "via surface port",
      channel: "cli",
      clientRequestId: "abs-b2-1",
    });

    assert.equal(result.outcome.kind, "settled");
    assert.equal(result.sessionRef, "surface-sess");
    assert.equal(result.definitionId, "surface-agent");
    assert.equal(typeof result.packSnapshotHash, "string");
  });

  it("runCli uses injected SurfacePort without compose", async () => {
    let engaged = false;
    const surface = {
      engageLocal: async () => {
        engaged = true;
        return {
          outcome: {
            kind: "settled" as const,
            sessionRef: asSessionRef("injected"),
            result: {},
          },
          sessionRef: asSessionRef("injected"),
          packSnapshotHash: "hash",
          definitionId: "injected-agent",
        };
      },
    };

    const code = await runCli(
      [
        "engage",
        "--agent",
        "/tmp/any-agent",
        "--task",
        "via injection",
        "--name",
        "injected-agent",
      ],
      { surface },
    );
    assert.equal(code, 0);
    assert.equal(engaged, true);
  });
});
