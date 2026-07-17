/**
 * PackResolverImpl — ordered extension name → absolute path (harness parity).
 *
 * Search order lives in adapters/capability/fs-store (ABS-A3 / D5 L4).
 * This module thin-wraps resolveFsModule → PackRef for the legacy PackResolver
 * face (A6/A7 migrate consumers to CapabilityStore).
 *
 * D2: missing pack → diagnostic level "error"; plan.ok === false (fail-closed).
 * Differs from harness WARN-only skip.
 */

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
import { resolveFsModule } from "../capability/fs-store.ts";

/** Local glue — mirrors ports.packRequestFromDefinition (avoid runtime .js port import under strip-types). */
function requestFromDefinition(def: AgentDefinition): PackResolveRequest {
  return { extensionSpecs: def.extensions ?? [] };
}

/**
 * Resolve a single extension name. Returns null when not found.
 * Thin wrap of resolveFsModule (FsCapabilityStore search order).
 */
export function resolveExtensionPath(
  name: string,
  projectRoot: string,
  homeDir: string = os.homedir(),
): PackRef | null {
  const found = resolveFsModule(name, projectRoot, homeDir);
  if (!found) return null;
  return { id: found.id, path: found.path, source: found.source };
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
