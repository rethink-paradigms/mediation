/**
 * S1b goldens: YamlDefinitionLoader maps agent.yaml → AgentDefinition,
 * fail-closed missing/invalid, prompt load, optional real company agent path.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  YamlDefinitionLoader,
  createYamlDefinitionLoader,
  mapYamlToDefinition,
} from "../../src/adapters/definition/yaml-definition-loader.ts";
import { MediationError } from "../../src/domain/errors.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(
  HERE,
  "../../fixtures/definition/case-basic",
);
const EXPECTED = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_ROOT, "expected.json"), "utf8"),
) as {
  id: string;
  name: string;
  model: string;
  thinking: string;
  agentMode: string;
  activeTools: string[];
  extensions: string[];
  skills: string[];
  tools: {
    builtin: string[];
    custom: string[];
    agentMode: string;
    activeTools: string[];
  };
  noCoreSkills: boolean;
  memory: { enabled: boolean; namespace: string; recallLimit: number };
  maxTokens: number;
  maxCostPerDayUsd: number;
  maxConcurrency: number;
  taskTimeoutMinutes: number;
  meta: Record<string, unknown>;
  promptContains: string;
};

const COMPANY_AGENTS = path.resolve(
  HERE,
  "../../../../agents",
);

describe("YamlDefinitionLoader — case-basic fixture", () => {
  const loader = createYamlDefinitionLoader();

  it("loads fixture agent.yaml into AgentDefinition (golden field map)", async () => {
    const def = await loader.load({
      name: "case-basic",
      rootDir: FIXTURE_ROOT,
    });

    assert.equal(def.id, EXPECTED.id);
    assert.equal(def.name, EXPECTED.name);
    assert.equal(def.rootDir, path.resolve(FIXTURE_ROOT));
    assert.equal(def.model, EXPECTED.model);
    assert.equal(def.thinking, EXPECTED.thinking);
    assert.equal(def.agentMode, EXPECTED.agentMode);
    assert.deepEqual(def.activeTools, EXPECTED.activeTools);
    assert.deepEqual(def.extensions, EXPECTED.extensions);
    assert.deepEqual(def.skills, EXPECTED.skills);
    assert.deepEqual(def.tools, EXPECTED.tools);
    assert.equal(def.noCoreSkills, EXPECTED.noCoreSkills);
    assert.deepEqual(def.memory, EXPECTED.memory);
    assert.equal(def.maxTokens, EXPECTED.maxTokens);
    assert.equal(def.maxCostPerDayUsd, EXPECTED.maxCostPerDayUsd);
    assert.equal(def.maxConcurrency, EXPECTED.maxConcurrency);
    assert.equal(def.taskTimeoutMinutes, EXPECTED.taskTimeoutMinutes);
    assert.deepEqual(def.meta, EXPECTED.meta);
    assert.ok(def.prompt?.includes(EXPECTED.promptContains));
  });

  it("implements DefinitionLoader.load as Promise", async () => {
    const loaderAsPort: {
      load: (ref: { name: string; rootDir: string }) => Promise<unknown>;
    } = new YamlDefinitionLoader();
    const def = await loaderAsPort.load({
      name: "case-basic",
      rootDir: FIXTURE_ROOT,
    });
    assert.ok(def && typeof def === "object");
    assert.equal((def as { name: string }).name, "case-basic");
  });
});

describe("YamlDefinitionLoader — fail-closed", () => {
  const loader = new YamlDefinitionLoader();

  it("missing agent.yaml → DEFINITION_NOT_FOUND", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s1b-"));
    await assert.rejects(
      () => loader.load({ name: "ghost", rootDir: tmp }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_NOT_FOUND");
        assert.match(err.message, /agent\.yaml/u);
        return true;
      },
    );
  });

  it("invalid YAML → DEFINITION_INVALID", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s1b-"));
    fs.writeFileSync(path.join(tmp, "agent.yaml"), "name: [unterminated\n", "utf8");
    await assert.rejects(
      () => loader.load({ name: "bad-yaml", rootDir: tmp }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_INVALID");
        return true;
      },
    );
  });

  it("missing name/model → DEFINITION_INVALID", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s1b-"));
    fs.writeFileSync(
      path.join(tmp, "agent.yaml"),
      "thinking: off\n",
      "utf8",
    );
    await assert.rejects(
      () => loader.load({ name: "incomplete", rootDir: tmp }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_INVALID");
        assert.match(err.message, /name|model/iu);
        return true;
      },
    );
  });

  it("prompt.md missing → DEFINITION_INVALID", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s1b-"));
    fs.writeFileSync(
      path.join(tmp, "agent.yaml"),
      [
        "name: no-prompt-file",
        "model: provider/model",
        "prompt: prompt.md",
        "",
      ].join("\n"),
      "utf8",
    );
    await assert.rejects(
      () => loader.load({ name: "no-prompt-file", rootDir: tmp }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_INVALID");
        assert.match(err.message, /prompt file not found/u);
        return true;
      },
    );
  });

  it("invalid thinking → DEFINITION_INVALID", async () => {
    assert.throws(
      () =>
        mapYamlToDefinition(
          { name: "x", model: "p/m", thinking: "ludicrous" },
          { name: "x", rootDir: "/tmp" },
          { loadPrompt: false },
        ),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_INVALID");
        return true;
      },
    );
  });
});

describe("YamlDefinitionLoader — model forms + inline prompt", () => {
  it("accepts structured model {provider,id}", () => {
    const def = mapYamlToDefinition(
      {
        name: "structured",
        model: { provider: "anthropic", id: "claude-haiku" },
        prompt: "You are inline.",
      },
      { name: "structured", rootDir: "/tmp/agent" },
      { loadPrompt: false },
    );
    assert.deepEqual(def.model, {
      provider: "anthropic",
      id: "claude-haiku",
    });
    assert.equal(def.prompt, "You are inline.");
  });

  it("loads relative prompt path content from rootDir", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-s1b-"));
    fs.writeFileSync(
      path.join(tmp, "agent.yaml"),
      [
        "name: inline-path",
        "model: p/m",
        "prompt: nested/sys.md",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.mkdirSync(path.join(tmp, "nested"));
    fs.writeFileSync(
      path.join(tmp, "nested", "sys.md"),
      "NESTED_PROMPT_BODY",
      "utf8",
    );

    const def = await new YamlDefinitionLoader().load({
      name: "inline-path",
      rootDir: tmp,
    });
    assert.equal(def.prompt, "NESTED_PROMPT_BODY");
  });
});

describe("YamlDefinitionLoader — optional real company agent", () => {
  const codingAgentRoot = path.join(COMPANY_AGENTS, "coding-agent");
  const hasCodingAgent = fs.existsSync(
    path.join(codingAgentRoot, "agent.yaml"),
  );

  it(
    "loads company/agents/coding-agent when present",
    { skip: !hasCodingAgent },
    async () => {
      const def = await new YamlDefinitionLoader().load({
        name: "coding-agent",
        rootDir: codingAgentRoot,
      });
      assert.equal(def.name, "coding-agent");
      assert.equal(typeof def.model, "string");
      assert.ok(
        Array.isArray(def.extensions) && (def.extensions?.length ?? 0) > 0,
      );
      assert.ok(
        typeof def.prompt === "string" && def.prompt.length > 0,
        "prompt.md content loaded",
      );
      assert.ok(
        def.prompt!.includes("coding agent") ||
          def.prompt!.includes("Rethink") ||
          def.prompt!.length > 20,
      );
    },
  );
});
