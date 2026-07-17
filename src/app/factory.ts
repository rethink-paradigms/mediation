/**
 * DefaultPresenceFactory — sole constructor of Presence (D0 P1 / D1).
 * App layer: domain + ports only (no Pi / OW / adapters).
 */

import type { AgentDefinition } from "../domain/definition.ts";
import { MediationError } from "../domain/errors.ts";
import type { PackLoadPlan, PackSnapshot } from "../domain/packs.ts";
import type {
  MaterializeOptions,
  PresenceFactory,
  AgentPresence,
} from "../domain/presence.ts";
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
  readonly packResolver: PackResolver;
  /** Injected so app does not import adapters (layer rule). */
  readonly toPackSnapshot: PackSnapshotFn;
  /**
   * Optional override for project root when resolving packs.
   * Default: definition.rootDir or MaterializeOptions.cwd.
   */
  readonly projectRoot?: string;
};

/**
 * Materialize: resolve packs → openSession → snapshotted Presence (idle).
 * Fail-closed when pack plan is not ok (D2).
 */
export class DefaultPresenceFactory implements PresenceFactory {
  private readonly engine: EnginePort;
  private readonly packResolver: PackResolver;
  private readonly toPackSnapshot: PackSnapshotFn;
  private readonly projectRoot?: string;
  private seq = 0;

  constructor(deps: DefaultPresenceFactoryDeps) {
    this.engine = deps.engine;
    this.packResolver = deps.packResolver;
    this.toPackSnapshot = deps.toPackSnapshot;
    this.projectRoot = deps.projectRoot;
  }

  async materialize(
    definition: AgentDefinition,
    opts?: MaterializeOptions,
  ): Promise<AgentPresence> {
    const projectRoot =
      this.projectRoot ?? opts?.cwd ?? definition.rootDir;

    const plan = this.packResolver.resolve(
      packRequestFromDefinition(definition),
      { projectRoot },
    );

    if (!plan.ok) {
      throw new MediationError(
        "PACK_RESOLVE_FAILED",
        `Pack resolve failed for agent "${definition.name}" (ok=false)`,
        { diagnostics: plan.diagnostics, packs: plan.packs },
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
}
