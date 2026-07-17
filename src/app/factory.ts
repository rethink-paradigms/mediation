/**
 * DefaultPresenceFactory — sole constructor of Presence (D0 P1 / D1).
 * App layer: domain + ports only (no Pi / OW / adapters).
 *
 * ABS-A7: optional CapabilityResolver path — agent-layer CapabilitySpec from
 * definition → resolve fail-closed → PackLoadPlan adapted for openSession.
 * Without resolver: existing PackResolver path (backward compat).
 */

import type {
  CapabilityDiagnostic,
  CapabilityPlan,
} from "../domain/capability.ts";
import type { CapabilitySpec } from "../domain/config-layer.ts";
import type { AgentDefinition } from "../domain/definition.ts";
import { MediationError } from "../domain/errors.ts";
import type {
  PackDiagnostic,
  PackLoadPlan,
  PackRef,
  PackSnapshot,
  PackSource,
} from "../domain/packs.ts";
import type {
  MaterializeOptions,
  PresenceFactory,
  AgentPresence,
} from "../domain/presence.ts";
import type { CapabilityResolver } from "../ports/capability-resolver.ts";
import type { CapabilityArtifact } from "../ports/capability-store.ts";
import type { EnginePort } from "../ports/engine.ts";
import type { PackResolver } from "../ports/pack-resolver.ts";
import { packRequestFromDefinition } from "../ports/pack-resolver.ts";
import { DefaultAgentPresence } from "./presence.ts";

/** Snapshots a resolved pack plan at materialize (typically adapters/packs.toPackSnapshot). */
export type PackSnapshotFn = (
  plan: PackLoadPlan,
  createdAt?: string,
) => PackSnapshot;

export type DefaultPresenceFactoryDeps = {
  readonly engine: EnginePort;
  /**
   * Legacy pack path (backward compat). Used when `capabilityResolver` is omitted.
   * Still required so existing call sites keep working without a resolver.
   */
  readonly packResolver: PackResolver;
  /** Injected so app does not import adapters (layer rule). */
  readonly toPackSnapshot: PackSnapshotFn;
  /**
   * Optional override for project root when resolving packs.
   * Default: definition.rootDir or MaterializeOptions.cwd.
   */
  readonly projectRoot?: string;
  /**
   * When provided, materialize prefers CapabilityResolver over PackResolver
   * (ABS-A7). Fail-closed if resolve plan.ok is false.
   */
  readonly capabilityResolver?: CapabilityResolver;
};

const PACK_SOURCES: ReadonlySet<string> = new Set([
  "explicit",
  "internal",
  "project-extensions",
  "agent",
  "families",
  "global-pi",
]);

/** Agent-layer CapabilitySpec from inert definition (extensions + tools/skills). */
export function capabilitySpecFromDefinition(
  definition: AgentDefinition,
): CapabilitySpec {
  return {
    ...(definition.extensions !== undefined
      ? { extensions: definition.extensions }
      : {}),
    ...(definition.tools !== undefined ? { tools: definition.tools } : {}),
    ...(definition.skills !== undefined ? { skills: definition.skills } : {}),
  };
}

function packSourceFromLocator(
  locator: Readonly<Record<string, unknown>> | undefined,
): PackSource {
  const source = locator?.source;
  if (typeof source === "string" && PACK_SOURCES.has(source)) {
    return source as PackSource;
  }
  return "explicit";
}

/**
 * Module path for openSession packPlan: entry.modulePath, else locator.path.
 * Returns undefined when neither is a non-empty string.
 */
export function modulePathFromArtifact(
  artifact: CapabilityArtifact,
): string | undefined {
  if (artifact.entry.kind === "module-path") {
    const p = artifact.entry.modulePath;
    if (typeof p === "string" && p.length > 0) return p;
  }
  const locPath = artifact.ref.locator?.path;
  if (typeof locPath === "string" && locPath.length > 0) return locPath;
  return undefined;
}

/**
 * Adapt resolved capability artifacts → PackLoadPlan for EnginePort.openSession.
 * Only refs with a module path (entry.modulePath or locator.path) become PackRefs.
 * Missing path on an otherwise-resolved artifact → error diagnostic (fail-closed).
 */
export function packLoadPlanFromCapabilityArtifacts(
  artifacts: readonly CapabilityArtifact[],
  plan: CapabilityPlan,
): PackLoadPlan {
  const packs: PackRef[] = [];
  const diagnostics: PackDiagnostic[] = plan.diagnostics.map(
    capabilityDiagnosticToPack,
  );

  for (const artifact of artifacts) {
    const modulePath = modulePathFromArtifact(artifact);
    if (modulePath === undefined) {
      diagnostics.push({
        level: "error",
        code: "capability_path_missing",
        packName: String(artifact.ref.id),
        message: `Capability "${artifact.ref.id}" has no module path (entry.modulePath or locator.path)`,
      });
      continue;
    }
    packs.push({
      id: String(artifact.ref.id),
      path: modulePath,
      source: packSourceFromLocator(artifact.ref.locator),
    });
  }

  const ok = !diagnostics.some((d) => d.level === "error");
  return { packs, diagnostics, ok };
}

function capabilityDiagnosticToPack(d: CapabilityDiagnostic): PackDiagnostic {
  return {
    level: d.level,
    code: d.code,
    message: d.message,
    ...(d.capabilityId !== undefined
      ? { packName: String(d.capabilityId) }
      : {}),
  };
}

/**
 * Materialize: resolve packs/capabilities → openSession → snapshotted Presence (idle).
 * Fail-closed when resolve plan is not ok (D2 / D5).
 */
export class DefaultPresenceFactory implements PresenceFactory {
  private readonly engine: EnginePort;
  private readonly packResolver: PackResolver;
  private readonly toPackSnapshot: PackSnapshotFn;
  private readonly projectRoot?: string;
  private readonly capabilityResolver?: CapabilityResolver;
  private seq = 0;

  constructor(deps: DefaultPresenceFactoryDeps) {
    this.engine = deps.engine;
    this.packResolver = deps.packResolver;
    this.toPackSnapshot = deps.toPackSnapshot;
    this.projectRoot = deps.projectRoot;
    this.capabilityResolver = deps.capabilityResolver;
  }

  async materialize(
    definition: AgentDefinition,
    opts?: MaterializeOptions,
  ): Promise<AgentPresence> {
    const projectRoot =
      this.projectRoot ?? opts?.cwd ?? definition.rootDir;

    const plan = await this.resolvePackPlan(definition, projectRoot);

    if (!plan.ok) {
      const viaCapability = this.capabilityResolver !== undefined;
      throw new MediationError(
        viaCapability ? "CAPABILITY_RESOLVE_FAILED" : "PACK_RESOLVE_FAILED",
        viaCapability
          ? `Capability resolve failed for agent "${definition.name}" (ok=false)`
          : `Pack resolve failed for agent "${definition.name}" (ok=false)`,
        {
          diagnostics: plan.diagnostics,
          packs: plan.packs,
        },
      );
    }

    const packSnapshot = this.toPackSnapshot(plan);

    let handle;
    try {
      handle = await this.engine.openSession({
        definition,
        packPlan: plan,
        resume: opts?.resume,
        cwd: opts?.cwd ?? definition.rootDir,
        settings: {
          inMemory: true,
          thinking: definition.thinking,
          maxTokens: definition.maxTokens,
        },
        tools: definition.tools ?? {},
      });
    } catch (err) {
      throw new MediationError(
        "MATERIALIZE_FAILED",
        `openSession failed for agent "${definition.name}"`,
        { cause: err },
      );
    }

    this.seq += 1;
    const id = `${definition.id}#${this.seq}`;

    const presence = new DefaultAgentPresence({
      id,
      definition,
      sessionRef: handle.sessionRef,
      packSnapshot,
      handle,
      status: "idle",
    });

    if (opts?.surface) {
      await presence.attach(opts.surface);
    }

    return presence;
  }

  /**
   * Prefer CapabilityResolver when injected; else PackResolver (legacy).
   */
  private async resolvePackPlan(
    definition: AgentDefinition,
    projectRoot: string,
  ): Promise<PackLoadPlan> {
    if (this.capabilityResolver) {
      const spec = capabilitySpecFromDefinition(definition);
      const result = await this.capabilityResolver.resolve({
        layers: [{ kind: "agent", spec }],
      });
      // Always adapt artifacts so path-missing surfaces as fail-closed even when
      // store hits returned ok plan with non-path entries.
      return packLoadPlanFromCapabilityArtifacts(
        result.artifacts,
        result.plan,
      );
    }

    return this.packResolver.resolve(packRequestFromDefinition(definition), {
      projectRoot,
    });
  }
}
