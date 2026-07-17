/**
 * PackResolverImpl — ordered extension name → absolute path (harness parity).
 *
 * Search order (from company/agents/_harness/resolve.ts):
 * 1. name contains `/` → projectRoot-relative
 * 2. tools/internal/<name>
 * 3. extensions/<name>
 * 4. .pi/extensions/<name>
 * 5. tools/families/<name>
 * 6. ~/.pi/agent/extensions/<name>
 * 7. absolute path if exists
 *
 * D2: missing pack → diagnostic level "error"; plan.ok === false (fail-closed).
 * Differs from harness WARN-only skip.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentDefinition } from "../../domain/definition.js";
import type {
  PackDiagnostic,
  PackLoadPlan,
  PackRef,
  PackSource,
} from "../../domain/packs.js";
import type {
  PackResolveOptions,
  PackResolveRequest,
  PackResolver,
} from "../../ports/pack-resolver.js";

/** Local glue — mirrors ports.packRequestFromDefinition (avoid runtime .js port import under strip-types). */
function requestFromDefinition(def: AgentDefinition): PackResolveRequest {
  return { extensionSpecs: def.extensions ?? [] };
}

/**
 * Resolve a single extension name. Returns null when not found.
 */
export function resolveExtensionPath(
  name: string,
  projectRoot: string,
  homeDir: string = os.homedir(),
): PackRef | null {
  const root = path.resolve(projectRoot);

  // 1. Slash → relative to project root
  if (name.includes("/")) {
    const relPath = path.resolve(root, name);
    if (fs.existsSync(relPath)) {
      return { id: name, path: relPath, source: "explicit" };
    }
  }

  // 2. tools/internal/<name>
  const internalPath = path.join(root, "tools", "internal", name);
  if (fs.existsSync(internalPath)) {
    return { id: name, path: internalPath, source: "internal" };
  }

  // 3. extensions/<name>
  const projectExtPath = path.join(root, "extensions", name);
  if (fs.existsSync(projectExtPath)) {
    return { id: name, path: projectExtPath, source: "project-extensions" };
  }

  // 4. .pi/extensions/<name>
  const dotPiPath = path.join(root, ".pi", "extensions", name);
  if (fs.existsSync(dotPiPath)) {
    return { id: name, path: dotPiPath, source: "agent" };
  }

  // 5. tools/families/<name>
  const familyPath = path.join(root, "tools", "families", name);
  if (fs.existsSync(familyPath)) {
    return { id: name, path: familyPath, source: "families" };
  }

  // 6. ~/.pi/agent/extensions/<name>
  const globalPath = path.join(homeDir, ".pi", "agent", "extensions", name);
  if (fs.existsSync(globalPath)) {
    return { id: name, path: globalPath, source: "global-pi" };
  }

  // 7. Absolute path if exists
  if (path.isAbsolute(name) && fs.existsSync(name)) {
    return { id: name, path: name, source: "explicit" };
  }

  return null;
}

/** True when plan is fail-closed (ok false or any error diagnostic). */
export function planHasErrors(plan: PackLoadPlan): boolean {
  return !plan.ok || plan.diagnostics.some((d) => d.level === "error");
}

export type PackResolverImplOptions = {
  /** Override home for tests (default: os.homedir()). */
  homeDir?: string;
};

/**
 * Resolve extension names against a project root (and optional home).
 */
export function resolvePackNames(
  extensionSpecs: readonly string[],
  projectRoot: string,
  homeDir: string = os.homedir(),
): PackLoadPlan {
  const root = path.resolve(projectRoot);
  const packs: PackRef[] = [];
  const diagnostics: PackDiagnostic[] = [];

  for (const name of extensionSpecs) {
    const pack = resolveExtensionPath(name, root, homeDir);
    if (pack) {
      packs.push(pack);
    } else {
      diagnostics.push({
        level: "error",
        code: "pack_not_found",
        packName: name,
        message: `Extension not found: "${name}"`,
      });
    }
  }

  const ok = !diagnostics.some((d) => d.level === "error");
  return { packs, diagnostics, ok };
}

export class PackResolverImpl implements PackResolver {
  private readonly homeDir: string;

  constructor(opts: PackResolverImplOptions = {}) {
    this.homeDir = opts.homeDir ?? os.homedir();
  }

  resolve(def: PackResolveRequest, opts: PackResolveOptions): PackLoadPlan {
    return resolvePackNames(def.extensionSpecs, opts.projectRoot, this.homeDir);
  }

  /**
   * Convenience for app/factory: AgentDefinition.extensions + rootDir.
   */
  resolveDefinition(def: AgentDefinition, projectRoot?: string): PackLoadPlan {
    return this.resolve(requestFromDefinition(def), {
      projectRoot: projectRoot ?? def.rootDir,
    });
  }

  /**
   * Explicit roots for fixtures/gauges without a full request object.
   */
  resolveSpecs(
    extensionSpecs: readonly string[],
    opts: { projectRoot: string },
  ): PackLoadPlan {
    return resolvePackNames(extensionSpecs, opts.projectRoot, this.homeDir);
  }
}

export function createPackResolver(opts?: PackResolverImplOptions): PackResolver {
  return new PackResolverImpl(opts);
}

/** Minimal AgentDefinition for tests (only fields used by resolveDefinition). */
export function agentDefForPacks(
  rootDir: string,
  extensions: readonly string[],
  name = "fixture-agent",
): AgentDefinition {
  return {
    id: name,
    name,
    rootDir,
    model: "test/fixture",
    extensions: [...extensions],
  };
}

export type { PackSource };
