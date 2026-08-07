/**
 * YamlDefinitionLoader — load inert AgentDefinition from agent.yaml (+ prompt),
 * with optional root · family · agent config layers from DISK (D5 L3).
 *
 * Convention (documented in EVIDENCE-COMPOSITION.md):
 * - each layer is a yaml file with the same agent.yaml shape (CapabilitySpec
 *   fields: extensions / tools / skills / engine, plus model / thinking / …);
 * - the AGENT layer is `<rootDir>/agent.yaml` and may declare:
 *     extends: <name-or-path>   family layer (sibling dir `../<name>/agent.yaml`
 *                               for a bare name, or a path from the agent root)
 *     root:    <name-or-path>   root layer (same resolution as extends)
 * - the loader option `rootConfigPath` supplies an implicit company root file
 *   used when the agent declares no `root:`;
 * - layers merge root → family → agent via mergeCapabilitySpecs + later-wins
 *   scalars; agent wins, family next, root last (see mergeDefinitionLayers);
 * - `extends` chains are loop-guarded and fail closed on missing/cycle.
 *
 * Fail-closed: missing/invalid yaml → MediationError DEFINITION_NOT_FOUND /
 * INVALID. Does not construct sessions (D0 inert definition).
 *
 * Backward compat: an agent.yaml with no `extends:`/`root:` (and no loader
 * rootConfigPath) loads EXACTLY as before — a single-file definition.
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
import type { ConfigLayerKind } from "../../domain/config-layer.ts";
import { mergeCapabilitySpecs, type CapabilitySpec } from "../../domain/config-layer.ts";
import type { DefinitionLoader } from "../../ports/definition-loader.ts";

export type YamlDefinitionLoaderOptions = {
  /** Config file name under agent root. Default: `agent.yaml`. */
  readonly configFileName?: string;
  /**
   * Implicit company ROOT layer file (absolute or project-relative path).
   * When set, every load() merges it as the root layer unless the agent's
   * `root:` field (or an explicit loadDefinition rootRef) overrides it.
   * Missing file → fail-closed DEFINITION_NOT_FOUND.
   */
  readonly rootConfigPath?: string;
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
  root: z.string().optional(),

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

/**
 * Relaxed layer schema for root/family yaml files (D5 L3).
 *
 * The agent layer keeps the strict schema (name + model required). Root and
 * family layers are partial: they may declare only the fields they own
 * (engine / thinking / model / tools / extensions / …) without a name or
 * model — those come from the agent layer during the merge.
 *
 * passthrough propagates through `.extend()` (zod 4), so forward-compat keys
 * still survive on every layer.
 */
const LayerYamlSchema = AgentYamlSchema.extend({
  name: z.string().min(1).optional(),
  model: z
    .union([z.string().min(1), StructuredModelSchema])
    .optional(),
});

/** Parsed shape of a root/family layer (name/model optional). */
type ParsedLayerYaml = z.output<typeof LayerYamlSchema>;

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
  "root",
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
 * Merge parsed config layers root → family → agent into one agent.yaml-shaped
 * record (D5 L3). Capability fields (extensions / skills / tools / engine) go
 * through mergeCapabilitySpecs (ordered-unique unions + later-wins policy);
 * every other field is later-wins (agent overrides family overrides root).
 * `extends`/`root` are chain metadata, not merged — the agent layer's
 * declarations survive for introspection on the final definition.
 *
 * Returns a plain record; mapYamlToDefinition re-validates it with the strict
 * AgentYamlSchema (name + model guaranteed by the agent layer).
 */
export function mergeDefinitionLayers(
  layers: readonly {
    readonly kind: ConfigLayerKind;
    readonly yaml: ParsedLayerYaml;
  }[],
): Record<string, unknown> {
  const effective = mergeCapabilitySpecs(
    layers.map(({ kind, yaml }) => ({
      kind,
      spec: capabilitySpecFromParsedLayer(yaml),
    })),
  );

  // Later-wins scalars in chain order (root → family → agent).
  const merged: Record<string, unknown> = {};
  for (const { yaml } of layers) {
    for (const [key, value] of Object.entries(yaml)) {
      if (LAYER_MERGE_SKIP.has(key)) continue;
      merged[key] = value;
    }
  }

  // Capability part with union semantics (only when non-empty, so a merged
  // layer stack that declares nothing stays field-absent like single-file).
  if (effective.extensions.length > 0) {
    merged.extensions = effective.extensions.map(String);
  } else {
    delete merged.extensions;
  }
  if (effective.skills.length > 0) {
    merged.skills = [...effective.skills];
  } else {
    delete merged.skills;
  }
  if (Object.keys(effective.tools).length > 0) {
    merged.tools = { ...effective.tools } as unknown as ParsedLayerYaml["tools"];
  } else {
    delete merged.tools;
  }
  if (effective.engine !== undefined) {
    merged.engine = effective.engine;
  } else {
    delete merged.engine;
  }

  // Chain metadata: the agent layer's own declarations survive.
  const agent = layers.at(-1);
  if (agent?.yaml.extends !== undefined) {
    merged.extends = agent.yaml.extends;
  } else {
    delete merged.extends;
  }
  if (agent?.yaml.root !== undefined) {
    merged.root = agent.yaml.root;
  } else {
    delete merged.root;
  }

  return merged;
}

/** Fields merged via mergeCapabilitySpecs / chain metadata — not shallow-copied. */
const LAYER_MERGE_SKIP = new Set([
  "extensions",
  "skills",
  "tools",
  "engine",
  "extends",
  "root",
]);

/** CapabilitySpec slice of a parsed layer (extensions / tools / skills / engine). */
function capabilitySpecFromParsedLayer(
  yaml: ParsedLayerYaml,
): CapabilitySpec {
  return {
    ...(yaml.extensions !== undefined ? { extensions: yaml.extensions } : {}),
    ...(yaml.tools !== undefined ? { tools: yaml.tools } : {}),
    ...(yaml.skills !== undefined ? { skills: yaml.skills } : {}),
    ...(yaml.engine !== undefined ? { engine: yaml.engine } : {}),
  };
}

/**
 * Resolve a layer reference (name-or-path) to a file path (D5 L3 convention).
 *
 * - path-like (contains "/", ends with .yaml/.yml, or absolute) → resolved
 *   against `fromDir`; a directory resolves to `<dir>/<configFileName>`;
 * - bare name → sibling convention: `<fromDir>/../<name>/<configFileName>`
 *   (families are sibling agent directories, mirroring the FS search order).
 */
export function resolveLayerFile(
  ref: string,
  fromDir: string,
  configFileName: string,
): string {
  const looksPath =
    ref.includes("/") ||
    ref.includes("\\") ||
    ref.endsWith(".yaml") ||
    ref.endsWith(".yml") ||
    path.isAbsolute(ref);
  if (looksPath) {
    const candidate = path.resolve(fromDir, ref);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return path.join(candidate, configFileName);
    }
    return candidate;
  }
  return path.join(path.resolve(fromDir, ".."), ref, configFileName);
}

/** Safety bound on extends chain depth (cycle guard belt-and-braces). */
const MAX_LAYER_DEPTH = 16;

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
  const rootFrom = yaml.root;

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
    ...(rootFrom !== undefined ? { root: rootFrom } : {}),
    ...(meta !== undefined ? { meta } : {}),
  };

  return def;
}

// ─── YamlDefinitionLoader ──────────────────────────────────────────────────

/**
 * Explicit layer references for loadDefinition (D5 L3).
 * `rootRef` / `familyRef` are name-or-path refs that OVERRIDE the agent
 * layer's declared `root:` / `extends:`. Omitted fields fall back to the
 * declared values (and rootConfigPath for root).
 */
export type LoadDefinitionOptions = {
  readonly rootRef?: string;
  readonly familyRef?: string;
};

/**
 * Load inert AgentDefinition from disk config layers (root → family → agent).
 *
 * `load` / `loadDefinitionWithLayers` auto-discover the chain from the agent
 * layer's `extends:` / `root:` plus the loader rootConfigPath. `loadDefinition`
 * accepts explicit refs that override the declarations. Single-file agents
 * (no extends/root/rootConfigPath) load exactly as before.
 */
export class YamlDefinitionLoader implements DefinitionLoader {
  private readonly configFileName: string;
  private readonly rootConfigPath: string | undefined;

  constructor(options?: YamlDefinitionLoaderOptions) {
    this.configFileName = options?.configFileName ?? "agent.yaml";
    this.rootConfigPath = options?.rootConfigPath;
  }

  async load(ref: AgentRef): Promise<AgentDefinition> {
    return this.loadDefinition(ref);
  }

  /**
   * Layered load with explicit root/family refs (override declared values).
   * No opts → auto-discovery (same as loadDefinitionWithLayers).
   */
  async loadDefinition(
    ref: AgentRef,
    opts?: LoadDefinitionOptions,
  ): Promise<AgentDefinition> {
    const layers = await this.resolveLayerChain(ref, opts);
    const merged = mergeDefinitionLayers(layers);
    // Prompts are pre-resolved per declaring layer (relative to that layer's
    // file), so the merged prompt is plain text — skip double file loading.
    return mapYamlToDefinition(merged, ref, { loadPrompt: false });
  }

  /** Auto-discover the layer chain from agent.yaml + loader rootConfigPath. */
  async loadDefinitionWithLayers(ref: AgentRef): Promise<AgentDefinition> {
    return this.loadDefinition(ref);
  }

  /**
   * Resolve the ordered chain [root?, ...familyChain, agent] from disk.
   * Loop-guarded by resolved file path; fail-closed on missing/cycle.
   */
  private async resolveLayerChain(
    ref: AgentRef,
    opts?: LoadDefinitionOptions,
  ): Promise<readonly { kind: ConfigLayerKind; yaml: ParsedLayerYaml }[]> {
    const agentFile = path.resolve(ref.rootDir, this.configFileName);
    const agentYaml = await this.readLayerYaml(agentFile, "agent", ref);

    const visited = new Set<string>([agentFile]);
    const chain: {
      kind: ConfigLayerKind;
      yaml: ParsedLayerYaml;
    }[] = [];

    // ── Root layer: explicit rootRef > agent `root:` > loader rootConfigPath.
    const rootRef =
      opts?.rootRef ??
      (typeof agentYaml.root === "string" ? agentYaml.root : undefined) ??
      this.rootConfigPath;
    if (rootRef !== undefined) {
      const rootFile = resolveLayerFile(
        rootRef,
        ref.rootDir,
        this.configFileName,
      );
      if (visited.has(rootFile)) {
        throw this.layerCycleError(rootRef, rootFile, visited);
      }
      visited.add(rootFile);
      chain.push({
        kind: "root",
        yaml: await this.readLayerYaml(rootFile, "root", ref),
      });
    }

    // ── Family chain: agent extends → family extends → … (recursive).
    const familyRef =
      opts?.familyRef ??
      (typeof agentYaml.extends === "string" ? agentYaml.extends : undefined);
    const families: { yaml: ParsedLayerYaml }[] = [];
    let currentRef = familyRef;
    let currentDir = ref.rootDir;
    while (currentRef !== undefined) {
      if (families.length >= MAX_LAYER_DEPTH) {
        throw new MediationError(
          "DEFINITION_INVALID",
          `extends chain too deep (max ${MAX_LAYER_DEPTH} layers): "${currentRef}"`,
          { agentName: ref.name, chain: [...visited] },
        );
      }
      const familyFile = resolveLayerFile(
        currentRef,
        currentDir,
        this.configFileName,
      );
      if (visited.has(familyFile)) {
        throw this.layerCycleError(currentRef, familyFile, visited);
      }
      visited.add(familyFile);
      const familyYaml = await this.readLayerYaml(familyFile, "family", ref);
      families.push({ yaml: familyYaml });
      currentRef =
        typeof familyYaml.extends === "string"
          ? familyYaml.extends
          : undefined;
      currentDir = path.dirname(familyFile);
    }

    // Order: root → base family → … → agent. Family chain was collected
    // agent-ward first, so reverse to base-first.
    return [
      ...chain,
      ...families.map((_f, i, arr) => ({
        kind: "family" as const,
        yaml: arr.at(-1 - i)!.yaml,
      })),
      { kind: "agent" as const, yaml: agentYaml },
    ];
  }

  /** Read + validate one layer file; fail-closed on missing/invalid. */
  private async readLayerYaml(
    filePath: string,
    kind: ConfigLayerKind,
    ref: AgentRef,
  ): Promise<ParsedLayerYaml> {
    const details = {
      configPath: filePath,
      agentName: ref.name,
      layer: kind,
    };

    let rawText: string;
    try {
      rawText = fs.readFileSync(filePath, "utf8");
    } catch {
      if (kind === "agent") {
        throw new MediationError(
          "DEFINITION_NOT_FOUND",
          `agent.yaml not found at ${filePath}`,
          details,
        );
      }
      throw new MediationError(
        "DEFINITION_NOT_FOUND",
        `${kind} layer not found at ${filePath}`,
        details,
      );
    }

    let raw: unknown;
    try {
      raw = parseYaml(rawText);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MediationError(
        "DEFINITION_INVALID",
        `${kind} layer yaml parse error: ${message}`,
        details,
      );
    }

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new MediationError(
        "DEFINITION_INVALID",
        `${kind} layer must be a mapping (top-level object)`,
        { ...details, got: typeof raw },
      );
    }

    let yaml: ParsedLayerYaml;
    try {
      yaml = LayerYamlSchema.parse(raw);
    } catch (err) {
      throwZodError(err, details);
    }

    // Prompt paths resolve against the DECLARING layer's directory (agent,
    // family, or root file each own their relative prompt files).
    if (yaml.prompt !== undefined) {
      yaml = {
        ...yaml,
        prompt: loadPromptField(
          yaml.prompt,
          path.dirname(filePath),
          details,
        ),
      };
    }
    return yaml;
  }

  private layerCycleError(
    ref: string,
    file: string,
    visited: ReadonlySet<string>,
  ): MediationError {
    return new MediationError(
      "DEFINITION_INVALID",
      `config layer cycle detected: "${ref}" revisits ${file} ` +
        `(chain: ${[...visited, file].join(" -> ")})`,
      { chain: [...visited, file] },
    );
  }
}

/** Create a YamlDefinitionLoader (configFileName + rootConfigPath options). */
export function createYamlDefinitionLoader(
  options?: YamlDefinitionLoaderOptions,
): YamlDefinitionLoader {
  return new YamlDefinitionLoader(options);
}


