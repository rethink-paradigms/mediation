/**
 * Sole createAgentSession door for @company/mediation (S0g second_door gauge).
 * All real Pi session construction for EnginePort goes through here.
 *
 * Aligns with @earendil-works/pi-coding-agent ~0.80 (ModelRuntime, not AuthStorage factory).
 */

import fs from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { AgentDefinition, ModelSpec } from "../../domain/definition.ts";
import type { OpenSessionRequest } from "../../ports/engine.ts";
import type { OpenedPiSession, PiEngineAdapterOptions } from "./types.ts";

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

function extensionPathsFromPlan(req: OpenSessionRequest): string[] {
  return req.packPlan.packs.map((pack) => pack.path);
}

/**
 * Open a real Pi AgentSession from OpenSessionRequest.
 * Settings default to inMemory (mediation-owned; D2 — do not load host settings).
 */
export async function openPiSession(
  req: OpenSessionRequest,
  opts: PiEngineAdapterOptions = {},
): Promise<OpenedPiSession> {
  const log = opts.log ?? (() => {});
  const cwd = req.cwd || req.definition.rootDir || process.cwd();
  const agentDir = getAgentDir();
  const inMemorySession =
    opts.inMemorySession ?? req.settings.inMemory !== false;

  const authPath =
    opts.authPath ?? path.join(agentDir, "auth.json");
  const modelRuntime = await ModelRuntime.create({
    authPath,
    modelsPath: path.join(agentDir, "models.json"),
  });

  const { provider, modelId } = parseModel(req.definition.model);
  const model = modelRuntime.getModel(provider, modelId);
  if (!model) {
    log("WARN", "Model not found in runtime", { provider, modelId });
  } else {
    log("INFO", "Model resolved", { provider, modelId });
  }

  const systemPrompt = resolveSystemPrompt(req.definition);
  const extensionPaths = extensionPathsFromPlan(req);

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

  const toolsPolicy = req.tools;
  const toolsAllow =
    toolsPolicy.builtin && toolsPolicy.builtin.length > 0
      ? [...toolsPolicy.builtin]
      : undefined;
  const excludeTools =
    toolsPolicy.exclude && toolsPolicy.exclude.length > 0
      ? [...toolsPolicy.exclude]
      : undefined;

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
    modelRuntime,
    tools: toolsAllow,
    excludeTools,
    noTools:
      toolsAllow === undefined && toolsPolicy.builtin === undefined
        ? "all"
        : undefined,
  });

  const agentMode =
    toolsPolicy.agentMode ?? req.definition.agentMode ?? "static";
  if (agentMode === "dynamic") {
    const active = [
      ...(toolsPolicy.activeTools ?? req.definition.activeTools ?? []),
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
