/**
 * YamlDefinitionLoader — load inert AgentDefinition from agent.yaml (+ prompt).
 *
 * Maps company harness AgentConfig (snake_case yaml) → domain AgentDefinition.
 * Fail-closed: missing/invalid yaml → MediationError DEFINITION_NOT_FOUND / INVALID.
 * Does not construct sessions (D0 inert definition).
 *
 * Validation uses a Zod schema (AgentYamlSchema). Unknown yaml keys pass through
 * (passthrough) so forward-compat harness keys like `tracing` are not rejected.
 * Replace with .strict() to catch unknown-key typos (at the cost of rejecting
 * future harness additions not yet in the schema).
 */

import fs from "node:fs";
import path from "node:path";
import { z, ZodError } from "zod";
import { parse as parseYaml } from "yaml";

import type {
  AgentDefinition,
  AgentRef,
  ModelSpec,
  ToolPolicy,
} from "../../domain/definition.ts";
import { ENGINE_KINDS } from "../../domain/engine.ts";
import { MediationError } from "../../domain/errors.ts";
import type { DefinitionLoader } from "../../ports/definition-loader.ts";

export type YamlDefinitionLoaderOptions = {
  /** Config file name under agent root. Default: `agent.yaml`. */
  readonly configFileName?: string;
};

// ─── Zod schema ────────────────────────────────────────────────────────────
// Each field mirrors the harness agent.yaml shape. Unknown keys pass through
// (passthrough) so forward-compat fields are not rejected.
// ────────────────────────────────────────────────────────────────────────────

/** Structured { provider, id } form, accepting `id` or `modelId` as the key. */
const StructuredModelSchema = z
  .object({
    provider: z.string().min(1),
    id: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
  })
  .refine(
    (v) => v.id !== undefined || v.modelId !== undefined,
    { message: '"model" structured form must have "id" or "modelId"' },
  )
  .transform((v) => ({
    provider: v.provider,
    id: (v.id ?? v.modelId) as string,
  }));

const AgentYamlSchema = z.object({
  name: z.string().min(1, '"name" must be a non-empty string'),
  model: z.union([
    z.string().min(1, '"model" must be a non-empty string or {provider, id}'),
    StructuredModelSchema,
  ]),

  // Optional scalars
  engine: z.enum(ENGINE_KINDS).optional(),
  thinking: z
    .enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
    .optional(),
  agent_mode: z.enum(["static", "dynamic"]).optional(),
  prompt: z.string().optional(),
  no_core_skills: z.boolean().optional(),
  max_tokens: z.number().finite().optional(),
  max_cost_per_day_usd: z.number().finite().optional(),
  max_concurrency: z.number().finite().optional(),
  task_timeout_minutes: z.number().finite().optional(),
  extends: z.string().optional(),

  // String arrays
  active_tools: z.string().array().optional(),
  extensions: z.string().array().optional(),
  skills: z.string().array().optional(),

  // Tool policy object
  tools: z
    .object({
      builtin: z.string().array().optional(),
      custom: z.string().array().optional(),
      exclude: z.string().array().optional(),
      agentMode: z.enum(["static", "dynamic"]).optional(),
      activeTools: z.string().array().optional(),
    })
    .passthrough()
    .optional(),

  // Memory config object
  memory: z
    .object({
      enabled: z.boolean(),
      namespace: z.string().optional(),
      recallLimit: z.number().finite().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

/** Inferred type of the validated yaml structure (post-transform). */
type ParsedAgentYaml = z.output<typeof AgentYamlSchema>;

/** Set of all top-level keys known to the schema (used for meta extraction). */
const KNOWN_TOP_KEYS = new Set([
  "name",
  "model",
  "engine",
  "thinking",
  "agent_mode",
  "prompt",
  "no_core_skills",
  "max_tokens",
  "max_cost_per_day_usd",
  "max_concurrency",
  "task_timeout_minutes",
  "extends",
  "active_tools",
  "extensions",
  "skills",
  "tools",
  "memory",
]);

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractResidualMeta(
  parsed: ParsedAgentYaml,
): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!KNOWN_TOP_KEYS.has(k)) meta[k] = v;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Convert a ZodError into a MediationError with DEFINITION_INVALID.
 * Preserves the Zod issue details for debugging.
 */
function throwZodError(
  err: unknown,
  details: Record<string, unknown>,
): never {
  if (err instanceof ZodError) {
    const messages = err.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new MediationError("DEFINITION_INVALID", messages.join("; "), {
      ...details,
      zodIssues: err.issues,
    });
  }
  throw err;
}

// ─── Prompt loading ────────────────────────────────────────────────────────

/**
 * Load prompt text from a path string, or return inline text.
 * Fail-closed when `prompt` looks like a file path (.md/.txt) but doesn't exist.
 *
 * Extracted for reuse — tests that only exercise mapping can pass
 * `loadPrompt: false` to mapYamlToDefinition instead of patching fs.
 */
export function loadPromptField(
  prompt: string,
  rootDir: string,
  details: Record<string, unknown>,
): string {
  const promptPath = path.resolve(rootDir, prompt);
  if (!fs.existsSync(promptPath) || !fs.statSync(promptPath).isFile()) {
    // Path-like without .md/.txt extension → treat as inline text.
    if (!prompt.endsWith(".md") && !prompt.endsWith(".txt")) {
      return prompt;
    }
    throw new MediationError(
      "DEFINITION_INVALID",
      `prompt file not found: ${promptPath}`,
      { ...details, prompt, promptPath },
    );
  }
  return fs.readFileSync(promptPath, "utf8");
}

// ─── Core mapper ───────────────────────────────────────────────────────────

/**
 * Pure mapping from parsed yaml → AgentDefinition.
 *
 * Validation is handled by AgentYamlSchema before this function.
 * This function only transforms validated shapes into the domain type.
 *
 * Pass `options.loadPrompt: false` in tests that don't need prompt file I/O
 * (e.g. inline prompt or mock prompt loading).
 */
export function mapYamlToDefinition(
  raw: unknown,
  ref: AgentRef,
  options: { loadPrompt?: boolean } = {},
): AgentDefinition {
  const details = { agentName: ref.name, rootDir: ref.rootDir };

  // 1. Validate raw yaml through the Zod schema.
  let yaml: ParsedAgentYaml;
  try {
    yaml = AgentYamlSchema.parse(raw);
  } catch (err) {
    throwZodError(err, details);
  }

  // 2. Extract residual unknown keys → meta (forward compat).
  const meta = extractResidualMeta(yaml);

  // 3. Parse individual fields (now validated — just extracting values).
  const model: ModelSpec =
    typeof yaml.model === "string"
      ? yaml.model
      : { provider: yaml.model.provider, id: yaml.model.id };

  const engine = yaml.engine;
  const thinking = yaml.thinking;
  const agentMode = yaml.agent_mode;
  const activeTools = yaml.active_tools;
  const noCoreSkills = yaml.no_core_skills;
  const extensions = yaml.extensions;
  const skills = yaml.skills;
  const maxTokens = yaml.max_tokens;
  const maxCostPerDayUsd = yaml.max_cost_per_day_usd;
  const maxConcurrency = yaml.max_concurrency;
  const taskTimeoutMinutes = yaml.task_timeout_minutes;
  const extendsFrom = yaml.extends;

  // 4. Parse tools sub-object.
  let tools: ToolPolicy | undefined;
  if (yaml.tools !== undefined) {
    tools = {
      ...(yaml.tools.builtin !== undefined
        ? { builtin: yaml.tools.builtin }
        : {}),
      ...(yaml.tools.custom !== undefined
        ? { custom: yaml.tools.custom }
        : {}),
      ...(yaml.tools.exclude !== undefined
        ? { exclude: yaml.tools.exclude }
        : {}),
      ...(yaml.tools.agentMode !== undefined
        ? { agentMode: yaml.tools.agentMode }
        : {}),
      ...(yaml.tools.activeTools !== undefined
        ? { activeTools: yaml.tools.activeTools }
        : {}),
    };
  }

  // 5. Mirror top-level agent_mode / active_tools onto tools policy.
  if (agentMode !== undefined || activeTools !== undefined) {
    tools = {
      ...tools,
      ...(agentMode !== undefined ? { agentMode } : {}),
      ...(activeTools !== undefined ? { activeTools } : {}),
    };
  }

  // 6. Parse memory.
  let memory: AgentDefinition["memory"];
  if (yaml.memory !== undefined) {
    memory = {
      enabled: yaml.memory.enabled,
      ...(yaml.memory.namespace !== undefined
        ? { namespace: yaml.memory.namespace }
        : {}),
      ...(yaml.memory.recallLimit !== undefined
        ? { recallLimit: yaml.memory.recallLimit }
        : {}),
    };
  }

  // 7. Load prompt (file or inline).
  let prompt: string | undefined;
  if (yaml.prompt !== undefined) {
    if (options.loadPrompt !== false) {
      prompt = loadPromptField(yaml.prompt, ref.rootDir, details);
    } else {
      prompt = yaml.prompt;
    }
  }

  // 8. Assemble AgentDefinition (all fields optional except id/name/rootDir/model).
  const def: AgentDefinition = {
    id: ref.name,
    name: ref.name,
    rootDir: path.resolve(ref.rootDir),
    model,
    ...(engine !== undefined ? { engine } : {}),
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
    ...(extendsFrom !== undefined ? { extends: extendsFrom } : {}),
    ...(meta !== undefined ? { meta } : {}),
  };

  return def;
}

// ─── YamlDefinitionLoader ──────────────────────────────────────────────────

/**
 * Load inert AgentDefinition from a yaml file on disk.
 */
export class YamlDefinitionLoader implements DefinitionLoader {
  private readonly configFileName: string;

  constructor(options?: YamlDefinitionLoaderOptions) {
    this.configFileName = options?.configFileName ?? "agent.yaml";
  }

  async load(ref: AgentRef): Promise<AgentDefinition> {
    const configPath = path.resolve(ref.rootDir, this.configFileName);
    const details = { configPath, agentName: ref.name };

    let rawText: string;
    try {
      rawText = fs.readFileSync(configPath, "utf8");
    } catch {
      throw new MediationError(
        "DEFINITION_NOT_FOUND",
        `agent.yaml not found at ${configPath}`,
        details,
      );
    }

    let yaml: unknown;
    try {
      yaml = parseYaml(rawText);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MediationError(
        "DEFINITION_INVALID",
        `agent.yaml parse error: ${message}`,
        details,
      );
    }

    if (typeof yaml !== "object" || yaml === null || Array.isArray(yaml)) {
      throw new MediationError(
        "DEFINITION_INVALID",
        "agent.yaml must be a mapping (top-level object)",
        { ...details, got: typeof yaml },
      );
    }

    return mapYamlToDefinition(yaml, ref);
  }
}

/** Create a YamlDefinitionLoader with optional config file name override. */
export function createYamlDefinitionLoader(
  options?: YamlDefinitionLoaderOptions,
): DefinitionLoader {
  return new YamlDefinitionLoader(options);
}


