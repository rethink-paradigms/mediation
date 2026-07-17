/**
 * RegistryCapabilityStore — in-process registry stub (ABS-R1 / D5 L5).
 *
 * Memory-backed map that simulates a remote capability registry without HTTP.
 * Real cloud/registry client is deferred; publish→get round-trip works in-process
 * (PyTool-style publish without network).
 *
 * Layer: adapters/ only — may implement CapabilityStore + CapabilityPublisher.
 */

import type { CapabilityId, CapabilityRef } from "../../domain/capability.ts";
import type {
  CapabilityArtifact,
  CapabilityGetOptions,
  CapabilityPublisher,
  CapabilityStore,
  PublishCapabilityInput,
} from "../../ports/capability-store.ts";

export type RegistryCapabilityStoreOptions = {
  /**
   * Optional seed artifacts (simulates pre-existing registry content).
   * Identity remains CapabilityId (+ optional version), never a path.
   */
  readonly seed?: readonly CapabilityArtifact[];
};

/**
 * In-memory registry stub implementing both store get and publisher publish.
 *
 * - `get` returns null when unknown (fail-closed callers).
 * - `publish` upserts by id + version and returns the stored ref with
 *   `origin: "registry"`.
 * - No network / HTTP — later slices may swap this for a real client.
 */
export class RegistryCapabilityStore
  implements CapabilityStore, CapabilityPublisher
{
  /** id → version key → artifact (version key is "" when version omitted). */
  private readonly byId = new Map<string, Map<string, CapabilityArtifact>>();

  constructor(opts?: RegistryCapabilityStoreOptions) {
    for (const artifact of opts?.seed ?? []) {
      this.upsert(artifact);
    }
  }

  async get(
    id: CapabilityId,
    opts?: CapabilityGetOptions,
  ): Promise<CapabilityArtifact | null> {
    const versions = this.byId.get(id);
    if (!versions || versions.size === 0) return null;

    if (opts?.version !== undefined) {
      return versions.get(versionKey(opts.version)) ?? null;
    }

    // No version selector: prefer last upsert order among versions.
    // Maps preserve insertion order; last entry is the most recently published.
    let last: CapabilityArtifact | null = null;
    for (const artifact of versions.values()) {
      last = artifact;
    }
    return last;
  }

  /**
   * Publish capability into the in-memory registry (D5 L5 stub).
   * Forces `origin: "registry"` on the stored/returned ref.
   * Locator may carry adapter-private keys (e.g. future registry URL); never identity.
   */
  async publish(input: PublishCapabilityInput): Promise<CapabilityRef> {
    const ref: CapabilityRef = {
      ...input.ref,
      origin: "registry",
    };
    const artifact: CapabilityArtifact = {
      ref,
      entry: input.entry,
    };
    this.upsert(artifact);
    return ref;
  }

  /** Diagnostic: number of distinct capability ids stored. */
  size(): number {
    return this.byId.size;
  }

  /** Test helper: clear all registry rows. */
  clear(): void {
    this.byId.clear();
  }

  private upsert(artifact: CapabilityArtifact): void {
    const id = artifact.ref.id;
    let versions = this.byId.get(id);
    if (!versions) {
      versions = new Map();
      this.byId.set(id, versions);
    }
    const key = versionKey(artifact.ref.version);
    // Re-insert so "latest" (last Map entry) tracks most recent publish.
    versions.delete(key);
    versions.set(key, artifact);
  }
}

export function createRegistryCapabilityStore(
  opts?: RegistryCapabilityStoreOptions,
): RegistryCapabilityStore {
  return new RegistryCapabilityStore(opts);
}

function versionKey(version: string | undefined): string {
  return version ?? "";
}
