/**
 * YamlDefinitionLoader — load inert AgentDefinition from agent.yaml (+ prompt).
 *
 * Maps company harness AgentConfig (snake_case yaml) → domain AgentDefinition.
 * Fail-closed: missing/invalid yaml → MediationError DEFINITION_NOT_FOUND / INVALID.
 * Does not construct sessions (D0 inert definition).
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import type {
  AgentDefinition,
  AgentRef,
  ModelSpec,
  ToolPolicy,
} from "../../domain/definition.ts";
import { MediationError } from "../../domain/errors.ts";
import type { DefinitionLoader } from "../../ports/definition-loader.ts";

const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const);

type ThinkingLevel = NonNullable<AgentDefinition["thinking"]>;

const AGENT_MODES = new Set(["static", "dynamic"] as const);
type AgentMode = "static" | "dynamic";

/** Known harness yaml keys (snake_case + camel residual). */
const KNOWN_YAML_KEYS = new Set([
  "name",
  "model",
  "thinking",
  "extends",
  "tools",
  "agent_mode",
  "active_tools",
  "extensions",
  "skills",
  "prompt",
  "no_core_skills",
  "memory",
  "max_tokens",
  "max_cost_per_day_usd",
  "max_concurrency",
  "task_timeout_minutes",
]);

export type YamlDefinitionLoaderOptions = {
  /** Config file name under agent root. Default: `agent.yaml`. */
  readonly configFileName?: string;
};

/**
 * Raw yaml shape (harness-compatible). Loose typing; validated in mapYaml.
 */
type RawAgentYaml = {
  name?: unknown;
  model?: unknown;
  thinking?: unknown;
  extends?: unknown;
  tools?: unknown;
  agent_mode?: unknown;
  active_tools?: unknown;
  extensions?: unknown;
  skills?: unknown;
  prompt?: unknown;
  no_core_skills?: unknown;
  memory?: unknown;
  max_tokens?: unknown;
  max_cost_per_day_usd?: unknown;
  max_concurrency?: unknown;
  task_timeout_minutes?: unknown;
  [key: string]: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringArray(
  value: unknown,
  field: string,
  details: Record<string, unknown>,
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new MediationError(
      "DEFINITION_INVALID",
      `agent.yaml field "${field}" must be an array of strings`,
      { ...details, field, value },
    );
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new MediationError(
        "DEFINITION_INVALID",
        `agent.yaml field "${field}" must be an array of strings`,
        { ...details, field, value },
      );
    }
    out.push(item);
  }
  return out;
}

function asOptionalNumber(
  value: unknown,
  field: string,
  details: Record<string, unknown>,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MediationError(
      "DEFINITION_INVALID",
      `agent.yaml field "${field}" must be a finite number`,
      { ...details, field, value },
    );
  }
  return value;
}

function asOptionalBoolean(
  value: unknown,
  field: string,
  details: Record<string, unknown>,
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new MediationError(
      "DEFINITION_INVALID",
      `agent.yaml field "${field}" must be a boolean`,
      { ...details, field, value },
    );
  }
  return value;
}

function parseModel(
  raw: unknown,
  details: Record<string, unknown>,
): ModelSpec {
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.length === 0) {
      throw new MediationError(
        "DEFINITION_INVALID",
        'agent.yaml "model" must be non-empty string or {provider,id}',
        details,
      );
    }
    return s;
  }
  if (isPlainObject(raw)) {
    const provider = raw.provider;
    const id = raw.id ?? raw.modelId;
    if (typeof provider === "string" && typeof id === "string" && provider && id) {
      return { provider, id };
    }
  }
  throw new MediationError(
    "DEFINITION_INVALID",
    'agent.yaml "model" must be "provider/model-id" string or {provider, id}',
    { ...details, model: raw },
  );
}

function parseThinking(
  raw: unknown,
  details: Record<string, unknown>,
): ThinkingLevel | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || !THINKING_LEVELS.has(raw as ThinkingLevel)) {
    throw new MediationError(
      "DEFINITION_INVALID",
      `agent.yaml "thinking" must be one of: ${[...THINKING_LEVELS].join(", ")}`,
      { ...details, thinking: raw },
    );
  }
  return raw as ThinkingLevel;
}

function parseAgentMode(
  raw: unknown,
  details: Record<string, unknown>,
): AgentMode | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || !AGENT_MODES.has(raw as AgentMode)) {
    throw new MediationError(
      "DEFINITION_INVALID",
      'agent.yaml "agent_mode" must be "static" or "dynamic"',
      { ...details, agent_mode: raw },
    );
  }
  return raw as AgentMode;
}

function parseTools(
  raw: unknown,
  details: Record<string, unknown>,
): ToolPolicy | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) {
    throw new MediationError(
      "DEFINITION_INVALID",
      'agent.yaml "tools" must be an object',
      { ...details, tools: raw },
    );
  }
  const builtin = asStringArray(raw.builtin, "tools.builtin", details);
  const custom = asStringArray(raw.custom, "tools.custom", details);
  const exclude = asStringArray(raw.exclude, "tools.exclude", details);
  const agentMode = parseAgentMode(raw.agentMode ?? raw.agent_mode, details);
  const activeTools = asStringArray(
    raw.activeTools ?? raw.active_tools,
    "tools.active_tools",
    details,
  );
  const policy: ToolPolicy = {
    ...(builtin !== undefined ? { builtin } : {}),
    ...(custom !== undefined ? { custom } : {}),
    ...(exclude !== undefined ? { exclude } : {}),
    ...(agentMode !== undefined ? { agentMode } : {}),
    ...(activeTools !== undefined ? { activeTools } : {}),
  };
  return policy;
}

function parseMemory(
  raw: unknown,
  details: Record<string, unknown>,
): AgentDefinition["memory"] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) {
    throw new MediationError(
      "DEFINITION_INVALID",
      'agent.yaml "memory" must be an object',
      { ...details, memory: raw },
    );
  }
  const enabled = raw.enabled;
  if (typeof enabled !== "boolean") {
    throw new MediationError(
      "DEFINITION_INVALID",
      'agent.yaml "memory.enabled" must be a boolean',
      { ...details, memory: raw },
    );
  }
  const namespace =
    raw.namespace === undefined || raw.namespace === null
      ? undefined
      : typeof raw.namespace === "string"
        ? raw.namespace
        : (() => {
            throw new MediationError(
              "DEFINITION_INVALID",
              'agent.yaml "memory.namespace" must be a string',
              { ...details, memory: raw },
            );
          })();
  const recallLimit = asOptionalNumber(
    raw.recallLimit,
    "memory.recallLimit",
    details,
  );
  return {
    enabled,
    ...(namespace !== undefined ? { namespace } : {}),
    ...(recallLimit !== undefined ? { recallLimit } : {}),
  };
}

/**
 * Resolve prompt field: relative .md/.txt path → file contents; else inline text.
 * Fail-closed when a path-like prompt is declared but missing.
 */
export function loadPromptField(
  prompt: string | undefined,
  rootDir: string,
  details: Record<string, unknown>,
): string | undefined {
  if (prompt === undefined || prompt === "") return undefined;

  const looksLikeFile =
    prompt.endsWith(".md") ||
    prompt.endsWith(".txt") ||
    prompt.includes("/") ||
    prompt.includes("\\");

  if (!looksLikeFile) {
    return prompt; // inline system prompt text
  }

  const promptPath = path.isAbsolute(prompt)
    ? prompt
    : path.resolve(rootDir, prompt);

  if (!fs.existsSync(promptPath) || !fs.statSync(promptPath).isFile()) {
    // Harness treats bare .md miss as WARN+inline; mediation fails closed for path-like values.
    if (prompt.endsWith(".md") || prompt.endsWith(".txt")) {
      throw new MediationError(
        "DEFINITION_INVALID",
        `prompt file not found: ${promptPath}`,
        { ...details, prompt, promptPath },
      );
    }
    // Path-like without extension and missing → treat as inline (rare)
    return prompt;
  }

  return fs.readFileSync(promptPath, "utf8");
}

function residualMeta(
  raw: RawAgentYaml,
): Readonly<Record<string, unknown>> | undefined {
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_YAML_KEYS.has(k)) {
      meta[k] = v;
    }
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Map parsed yaml object + AgentRef → AgentDefinition.
 * Exported for unit tests without fs for pure mapping cases.
 */
export function mapYamlToDefinition(
  raw: unknown,
  ref: AgentRef,
  options: { loadPrompt?: boolean } = {},
): AgentDefinition {
  const details = { rootDir: ref.rootDir, name: ref.name };
  if (!isPlainObject(raw)) {
    throw new MediationError(
      "DEFINITION_INVALID",
      "agent.yaml root must be a mapping/object",
      details,
    );
  }
  const yaml = raw as RawAgentYaml;

  if (typeof yaml.name !== "string" || yaml.name.trim() === "") {
    throw new MediationError(
      "DEFINITION_INVALID",
      'agent.yaml requires non-empty string "name"',
      details,
    );
  }
  if (yaml.model === undefined || yaml.model === null) {
    throw new MediationError(
      "DEFINITION_INVALID",
      'agent.yaml requires "model"',
      details,
    );
  }

  const name = yaml.name.trim();
  const model = parseModel(yaml.model, details);
  const thinking = parseThinking(yaml.thinking, details);
  const agentMode = parseAgentMode(yaml.agent_mode, details);
  const activeTools = asStringArray(yaml.active_tools, "active_tools", details);
  const extensions = asStringArray(yaml.extensions, "extensions", details);
  const skills = asStringArray(yaml.skills, "skills", details);
  const noCoreSkills = asOptionalBoolean(
    yaml.no_core_skills,
    "no_core_skills",
    details,
  );
  const maxTokens = asOptionalNumber(yaml.max_tokens, "max_tokens", details);
  const maxCostPerDayUsd = asOptionalNumber(
    yaml.max_cost_per_day_usd,
    "max_cost_per_day_usd",
    details,
  );
  const maxConcurrency = asOptionalNumber(
    yaml.max_concurrency,
    "max_concurrency",
    details,
  );
  const taskTimeoutMinutes = asOptionalNumber(
    yaml.task_timeout_minutes,
    "task_timeout_minutes",
    details,
  );
  const extendsPath =
    yaml.extends === undefined || yaml.extends === null
      ? undefined
      : typeof yaml.extends === "string"
        ? yaml.extends
        : (() => {
            throw new MediationError(
              "DEFINITION_INVALID",
              'agent.yaml "extends" must be a string path',
              { ...details, extends: yaml.extends },
            );
          })();

  let tools = parseTools(yaml.tools, details);
  // Mirror top-level agent_mode / active_tools onto tools policy when present.
  if (agentMode !== undefined || activeTools !== undefined) {
    tools = {
      ...(tools ?? {}),
      ...(agentMode !== undefined ? { agentMode } : {}),
      ...(activeTools !== undefined ? { activeTools } : {}),
    };
  }

  const memory = parseMemory(yaml.memory, details);
  const meta = residualMeta(yaml);

  let prompt: string | undefined;
  if (yaml.prompt !== undefined && yaml.prompt !== null) {
    if (typeof yaml.prompt !== "string") {
      throw new MediationError(
        "DEFINITION_INVALID",
        'agent.yaml "prompt" must be a string (path or inline text)',
        { ...details, prompt: yaml.prompt },
      );
    }
    if (options.loadPrompt === false) {
      prompt = yaml.prompt;
    } else {
      prompt = loadPromptField(yaml.prompt, ref.rootDir, details);
    }
  }

  const rootDir = path.resolve(ref.rootDir);

  const def: AgentDefinition = {
    id: name,
    name,
    rootDir,
    model,
    ...(thinking !== undefined ? { thinking } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(extensions !== undefined ? { extensions } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(agentMode !== undefined ? { agentMode } : {}),
    ...(activeTools !== undefined ? { activeTools } : {}),
    ...(noCoreSkills !== undefined ? { noCoreSkills } : {}),
    ...(memory !== undefined ? { memory } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(maxCostPerDayUsd !== undefined ? { maxCostPerDayUsd } : {}),
    ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
    ...(taskTimeoutMinutes !== undefined ? { taskTimeoutMinutes } : {}),
    ...(extendsPath !== undefined ? { extends: extendsPath } : {}),
    ...(meta !== undefined ? { meta } : {}),
  };
  return def;
}

export class YamlDefinitionLoader implements DefinitionLoader {
  private readonly configFileName: string;

  constructor(options: YamlDefinitionLoaderOptions = {}) {
    this.configFileName = options.configFileName ?? "agent.yaml";
  }

  async load(ref: AgentRef): Promise<AgentDefinition> {
    const rootDir = path.resolve(ref.rootDir);
    const configPath = path.join(rootDir, this.configFileName);

    if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
      throw new MediationError(
        "DEFINITION_NOT_FOUND",
        `No ${this.configFileName} at ${configPath}`,
        { rootDir, name: ref.name, configPath },
      );
    }

    let text: string;
    try {
      text = fs.readFileSync(configPath, "utf8");
    } catch (err) {
      throw new MediationError(
        "DEFINITION_NOT_FOUND",
        `Cannot read ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        { rootDir, name: ref.name, configPath, cause: err },
      );
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (err) {
      throw new MediationError(
        "DEFINITION_INVALID",
        `Invalid YAML in ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        { rootDir, name: ref.name, configPath, cause: err },
      );
    }

    if (parsed === null || parsed === undefined) {
      throw new MediationError(
        "DEFINITION_INVALID",
        `Empty agent.yaml at ${configPath}`,
        { rootDir, name: ref.name, configPath },
      );
    }

    return mapYamlToDefinition(parsed, { name: ref.name, rootDir });
  }
}

export function createYamlDefinitionLoader(
  options?: YamlDefinitionLoaderOptions,
): YamlDefinitionLoader {
  return new YamlDefinitionLoader(options);
}
