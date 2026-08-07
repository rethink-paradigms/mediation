/**
 * Sole prime-agent createAgentSession door for @company/mediation (S0g
 * second_door gauge — allowed dirs: adapters/pi AND adapters/prime).
 * All real Prime session construction for EnginePort goes through here.
 *
 * Aligns with the installed prime-agent fork (dist/core/*.d.ts):
 * - Model resolution: ModelRegistry.create(authStorage, modelsJsonPath?) →
 *   getAll() → find by provider+id (no getModel helper, no ModelRuntime).
 * - Fork CreateAgentSessionOptions has NO excludeTools / NO modelRuntime:
 *   tool policy maps to the allowlist (`tools` / `allowedToolNames`) with
 *   `noTools: "all"` when no allowlist is declared. `toolsPolicy.exclude`
 *   maps to allowlist subtraction when a builtin allowlist exists; otherwise
 *   it cannot be expressed on the fork and is surfaced via WARN, never
 *   silently dropped.
 * - getAgentDir() = ~/.prime/agent (fork config dir — different from Pi).
 *
 * ABS-A8 / D5 L4 — absolute paths only at this Prime/FS adapter boundary:
 * - Extension load paths come **only** from `OpenSessionRequest.packPlan.packs[].path`
 *   (`PackRef.path`). This adapter does not re-resolve capability ids, scan
 *   definition extensions, or invent filesystem paths.
 * - Upstream (`DefaultPresenceFactory`) produces that plan solely via
 *   CapabilityResolver → `packLoadPlanFromCapabilityArtifacts` (capability
 *   `entry.modulePath` / `locator.path` → `PackRef.path`).
 */

import fs from "node:fs";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "prime-agent";

import type { AgentDefinition, ModelSpec, ToolPolicy } from "../../domain/definition.ts";
import type { PackLoadPlan } from "../../domain/packs.ts";
import type { OpenSessionRequest } from "../../ports/engine.ts";
import type { OpenedPrimeSession, PrimeEngineAdapterOptions } from "./types.ts";

function parseModel(model: ModelSpec): { provider: string; modelId: string } {
  if (typeof model === "string") {
    const slash = model.indexOf("/");
    if (slash === -1) {
      throw new Error(
        `Invalid model string "${model}" — expected "provider/model-id"`,
      );
    }
    return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) };
  }
  return { provider: model.provider, modelId: model.id };
}

function resolveSystemPrompt(definition: AgentDefinition): string | undefined {
  const p = definition.prompt;
  if (p === undefined || p === "") return undefined;
  const candidates = [
    p,
    path.isAbsolute(p) ? p : path.join(definition.rootDir, p),
  ];
  for (const c of candidates) {
    if (
      (c.endsWith(".md") || c.endsWith(".txt")) &&
      fs.existsSync(c) &&
      fs.statSync(c).isFile()
    ) {
      return fs.readFileSync(c, "utf8");
    }
  }
  if (!p.endsWith(".md") && !p.endsWith(".txt")) {
    return p;
  }
  return p;
}

/**
 * Map packPlan → Prime additionalExtensionPaths (ABS-A8).
 * Reads only `PackRef.path` — capability module-path adaptation is factory/A7.
 * Skips empty paths; order matches plan.packs (load order preserved).
 * Twin of adapters/pi's extensionPathsFromPackPlan (kept parallel so the Pi
 * door surface is untouched).
 */
export function extensionPathsFromPackPlan(plan: PackLoadPlan): string[] {
  return plan.packs
    .map((pack) => pack.path)
    .filter((p) => typeof p === "string" && p.length > 0);
}

/**
 * Fork has no getModel helper — find by provider+id over ModelRegistry.getAll()
 * (built-in catalog + models.json custom models). Generic over the model type
 * so the returned value is assignable to createAgentSession's `model` option
 * (Model<any> from the fork) and unit tests can pass a plain fake registry.
 */
export function findModel<M extends { provider: string; id: string }>(
  registry: { getAll(): readonly M[] },
  provider: string,
  modelId: string,
): M | undefined {
  for (const m of registry.getAll()) {
    if (m.provider === provider && m.id === modelId) return m;
  }
  return undefined;
}

export type PrimeToolsMapping = {
  /** Allowlist of tool names (fork `tools` → allowedToolNames + initialActive). */
  readonly tools?: string[];
  readonly noTools?: "all";
  /** Excludes that could not be expressed (no builtin allowlist to subtract). */
  readonly droppedExcludes: readonly string[];
};

/**
 * ToolPolicy → fork CreateAgentSessionOptions tool fields.
 * Fork has NO excludeTools; exclusion maps to allowlist subtraction.
 */
export function primeToolsFromPolicy(policy: ToolPolicy): PrimeToolsMapping {
  const builtin =
    policy.builtin && policy.builtin.length > 0 ? [...policy.builtin] : undefined;
  const exclude =
    policy.exclude && policy.exclude.length > 0 ? [...policy.exclude] : undefined;

  if (!exclude) {
    return {
      tools: builtin,
      noTools: builtin === undefined ? "all" : undefined,
      droppedExcludes: [],
    };
  }
  if (builtin) {
    const tools = builtin.filter((t) => !exclude.includes(t));
    return {
      tools,
      noTools: tools.length === 0 ? "all" : undefined,
      droppedExcludes: [],
    };
  }
  return {
    tools: undefined,
    noTools: "all",
    droppedExcludes: exclude,
  };
}

/**
 * Open a real Prime AgentSession from OpenSessionRequest.
 * Settings default to inMemory (mediation-owned; D2 — do not load host settings).
 *
 * Extension bind: `packPlan` only (see file header / extensionPathsFromPackPlan).
 */
export async function openPrimeSession(
  req: OpenSessionRequest,
  opts: PrimeEngineAdapterOptions = {},
): Promise<OpenedPrimeSession> {
  const log = opts.log ?? (() => {});
  const cwd = req.cwd || req.definition.rootDir || process.cwd();
  const agentDir = getAgentDir();
  const inMemorySession =
    opts.inMemorySession ?? req.settings.inMemory !== false;

  // Fork config dir (~/.prime/agent). auth.json holds provider creds;
  // models.json is absent here — ModelRegistry falls back to built-in catalog.
  const authStorage =
    opts.authStorage ?? AuthStorage.create(opts.authPath ?? path.join(agentDir, "auth.json"));
  const modelRegistry =
    opts.modelRegistry ?? ModelRegistry.create(authStorage, path.join(agentDir, "models.json"));

  const { provider, modelId } = parseModel(req.definition.model);
  const model = findModel(modelRegistry, provider, modelId);
  if (!model) {
    log("WARN", "Model not found in registry", { provider, modelId });
  } else {
    log("INFO", "Model resolved", { provider, modelId });
  }

  const systemPrompt = resolveSystemPrompt(req.definition);
  // D5 L4: FS paths only here — already on PackRef from factory/capability boundary.
  const extensionPaths = extensionPathsFromPackPlan(req.packPlan);

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: extensionPaths,
    systemPrompt,
  });
  await resourceLoader.reload();
  log("INFO", "ResourceLoader ready", {
    extensions: extensionPaths.length,
  });

  let sessionManager: SessionManager;
  if (req.resume) {
    const resumePath = String(req.resume);
    if (fs.existsSync(resumePath)) {
      const sessionsDir = path.dirname(resumePath);
      sessionManager = SessionManager.open(resumePath, sessionsDir);
      log("INFO", "Session resumed", { path: resumePath });
    } else if (inMemorySession) {
      sessionManager = SessionManager.inMemory(cwd);
      log("WARN", "resume path missing; inMemory session", { resumePath });
    } else {
      const sessionsDir = path.join(req.definition.rootDir, "sessions");
      fs.mkdirSync(sessionsDir, { recursive: true });
      sessionManager = SessionManager.create(cwd, sessionsDir);
      log("WARN", "resume path missing; fresh file session", { resumePath });
    }
  } else if (inMemorySession) {
    sessionManager = SessionManager.inMemory(cwd);
  } else {
    const sessionsDir = path.join(req.definition.rootDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    sessionManager = SessionManager.create(cwd, sessionsDir);
  }

  // D2: mediation-owned settings — never silently load host user settings.
  const settingsManager = SettingsManager.inMemory({});

  const toolMapping = primeToolsFromPolicy(req.tools);
  if (toolMapping.droppedExcludes.length > 0) {
    log("WARN", "exclude cannot be expressed on prime (no excludeTools); dropped", {
      exclude: toolMapping.droppedExcludes,
    });
  }

  const thinking =
    req.settings.thinking ?? req.definition.thinking ?? "off";

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: model ?? undefined,
    thinkingLevel: thinking,
    resourceLoader,
    sessionManager,
    settingsManager,
    modelRegistry,
    // Fork allowlist mapping (no excludeTools): `tools` → allowedToolNames +
    // initialActiveToolNames; noTools:"all" → start with none when no allowlist.
    tools: toolMapping.tools,
    allowedToolNames: toolMapping.tools,
    noTools: toolMapping.noTools,
  });

  const agentMode =
    req.tools.agentMode ?? req.definition.agentMode ?? "static";
  if (agentMode === "dynamic") {
    const active = [
      ...(req.tools.activeTools ?? req.definition.activeTools ?? []),
    ];
    if (active.length > 0 && typeof session.setActiveToolsByName === "function") {
      session.setActiveToolsByName(active);
    }
  }

  if (typeof session.bindExtensions === "function") {
    await session.bindExtensions({
      onError: (err) => {
        log("ERROR", "Extension bind error", {
          path: err.extensionPath,
          error: err.error,
        });
      },
    });
  }

  const sessionRefValue =
    session.sessionFile && session.sessionFile.length > 0
      ? session.sessionFile
      : session.sessionId;

  log("INFO", "AgentSession created", { sessionRef: sessionRefValue });

  return { session, sessionRefValue };
}
