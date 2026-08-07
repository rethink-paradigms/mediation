/**
 * S2e: yaml agent definition — engine: <kind> mapping, fail-closed bogus,
 * engine stays a KNOWN top-level key (not residual meta).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createYamlDefinitionLoader,
  mapYamlToDefinition,
} from "../../src/adapters/definition/yaml-definition-loader.ts";
import { MediationError } from "../../src/domain/errors.ts";

describe("yaml definition engine field (S2e)", () => {
  it("engine: prime maps onto AgentDefinition.engine", () => {
    const def = mapYamlToDefinition(
      { name: "p", model: "test/model", engine: "prime" },
      { name: "p", rootDir: "/tmp/p" },
      { loadPrompt: false },
    );
    assert.equal(def.engine, "prime");
  });

  it("all three kinds map onto AgentDefinition.engine", () => {
    for (const kind of ["pi", "prime", "mock"] as const) {
      const def = mapYamlToDefinition(
        { name: "p", model: "test/model", engine: kind },
        { name: "p", rootDir: "/tmp/p" },
        { loadPrompt: false },
      );
      assert.equal(def.engine, kind);
    }
  });

  it("engine absent → no engine field on the definition", () => {
    const def = mapYamlToDefinition(
      { name: "p", model: "test/model" },
      { name: "p", rootDir: "/tmp/p" },
      { loadPrompt: false },
    );
    assert.ok(!("engine" in def));
  });

  it("engine: bogus → DEFINITION_INVALID (fail-closed)", () => {
    assert.throws(
      () =>
        mapYamlToDefinition(
          { name: "p", model: "test/model", engine: "bogus" },
          { name: "p", rootDir: "/tmp/p" },
          { loadPrompt: false },
        ),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_INVALID");
        return true;
      },
    );
  });

  it("engine is a KNOWN top-level key — not pushed into meta", () => {
    const def = mapYamlToDefinition(
      { name: "p", model: "test/model", engine: "mock", tracing: true },
      { name: "p", rootDir: "/tmp/p" },
      { loadPrompt: false },
    );
    assert.equal(def.engine, "mock");
    // unknown key still lands in meta; engine must not
    assert.deepEqual(def.meta, { tracing: true });
  });

  it("full loader round-trip from agent.yaml", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s2e-"));
    fs.writeFileSync(
      path.join(tmp, "agent.yaml"),
      "name: s2e-agent\nmodel: test/model\nengine: prime\nprompt: You are a test agent.\n",
      "utf8",
    );
    const def = await createYamlDefinitionLoader().load({
      name: "s2e-agent",
      rootDir: tmp,
    });
    assert.equal(def.engine, "prime");
  });
});
