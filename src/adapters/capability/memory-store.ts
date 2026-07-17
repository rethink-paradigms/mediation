/**
 * In-memory CapabilityStore — map of CapabilityId → CapabilityArtifact for tests.
 * Not durable across process restarts (ABS-A4). No filesystem.
 *
 * Implements optional CapabilityPublisher so tests can seed via put or publish.
 */

import type {
  CapabilityId,
  CapabilityRef,
} from "../../domain/capability.ts";
import type {
  CapabilityArtifact,
  CapabilityGetOptions,
  CapabilityPublisher,
  CapabilityStore,
  PublishCapabilityInput,
} from "../../ports/capability-store.ts";

export class MemoryCapabilityStore
  implements CapabilityStore, CapabilityPublisher
{
  /** Canonical id → latest (or only) artifact. */
  private readonly byId = new Map<string, CapabilityArtifact>();
  /** id → version → artifact for versioned get. */
  private readonly byIdVersion = new Map<
    string,
    Map<string, CapabilityArtifact>
  >();

  constructor(seed?: readonly CapabilityArtifact[]) {
    if (seed) {
      for (const artifact of seed) {
        this.write(artifact);
      }
    }
  }

  /**
   * Test helper: store or replace an artifact by CapabilityId.
   * When `ref.version` is set, also indexes under that version.
   */
  async put(artifact: CapabilityArtifact): Promise<void> {
    this.write(artifact);
  }

  async get(
    id: CapabilityId,
    opts?: CapabilityGetOptions,
  ): Promise<CapabilityArtifact | null> {
    if (opts?.version !== undefined) {
      return this.byIdVersion.get(id)?.get(opts.version) ?? null;
    }
    return this.byId.get(id) ?? null;
  }

  async publish(input: PublishCapabilityInput): Promise<CapabilityRef> {
    await this.put({ ref: input.ref, entry: input.entry });
    return input.ref;
  }

  /** Test/diagnostic: number of distinct capability ids. */
  size(): number {
    return this.byId.size;
  }

  /** Test helper: clear all rows. */
  clear(): void {
    this.byId.clear();
    this.byIdVersion.clear();
  }

  private write(artifact: CapabilityArtifact): void {
    const id = artifact.ref.id;
    this.byId.set(id, artifact);
    const version = artifact.ref.version;
    if (version !== undefined) {
      let versions = this.byIdVersion.get(id);
      if (!versions) {
        versions = new Map();
        this.byIdVersion.set(id, versions);
      }
      versions.set(version, artifact);
    }
  }
}
