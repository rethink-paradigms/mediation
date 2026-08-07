/**
 * CompositeCapabilityStore — ordered CapabilityStore chain (D5 L2 / L4 / ABS-A2).
 *
 * Resolve/fetch walks the chain in order; the FIRST store that returns a hit
 * wins (registry → fs by default at composition). When every store misses,
 * get returns null and callers fail closed (CapabilityResolver turns a null
 * into an error diagnostic, so materialize never half-loads).
 *
 * Publish (D5 L5) routes to a single publisher — the registry in the default
 * composition — so builder agents write once and the composite reads it back
 * through the registry head of the chain, without any filesystem path.
 *
 * Layer rule: adapters/ only — may implement CapabilityStore + CapabilityPublisher.
 */

import { MediationError } from "../../domain/errors.ts";
import type { CapabilityId, CapabilityRef } from "../../domain/capability.ts";
import type {
  CapabilityArtifact,
  CapabilityGetOptions,
  CapabilityPublisher,
  CapabilityStore,
  PublishCapabilityInput,
} from "../../ports/capability-store.ts";

export type CompositeCapabilityStoreOptions = {
  /**
   * Ordered store chain; first hit wins. Empty chain is legal (get always
   * returns null — a fully fail-closed store). Default: [].
   */
  readonly stores?: readonly CapabilityStore[];
  /**
   * Single publish target (the registry in the default registry → fs chain).
   * publish() fails closed when unset.
   */
  readonly publisher?: CapabilityPublisher;
};

/**
 * Ordered-chain CapabilityStore.
 *
 * - `get` checks stores in order; first non-null hit wins. Options (version)
 *   are forwarded to every store: versioned stores (registry / memory) honor
 *   them; unversioned stores (fs) ignore them by design (D5: fs is one
 *   adapter; version/digest lives in the registry medium, not the FS layout).
 * - `publish` routes to the configured publisher only.
 * - A store that is BOTH in the chain and the publisher works naturally
 *   (registry stub): publish writes the head, subsequent get hits it first.
 */
export class CompositeCapabilityStore
  implements CapabilityStore, CapabilityPublisher
{
  private readonly stores: readonly CapabilityStore[];
  private readonly publisher: CapabilityPublisher | undefined;

  constructor(opts: CompositeCapabilityStoreOptions = {}) {
    this.stores = opts.stores ?? [];
    this.publisher = opts.publisher;
  }

  async get(
    id: CapabilityId,
    opts?: CapabilityGetOptions,
  ): Promise<CapabilityArtifact | null> {
    for (const store of this.stores) {
      const hit = await store.get(id, opts);
      if (hit !== null) return hit;
    }
    return null;
  }

  async publish(input: PublishCapabilityInput): Promise<CapabilityRef> {
    if (this.publisher === undefined) {
      throw new MediationError(
        "POLICY_VIOLATION",
        "CompositeCapabilityStore has no publisher; publish is unavailable " +
          "(wire a registry store as the publisher)",
        { id: String(input.ref.id) },
      );
    }
    return this.publisher.publish(input);
  }

  /** Ordered chain snapshot (composition wiring + diagnostics). */
  storesSnapshot(): readonly CapabilityStore[] {
    return this.stores;
  }

  /** Publisher snapshot (undefined when publish is unavailable). */
  publisherSnapshot(): CapabilityPublisher | undefined {
    return this.publisher;
  }
}

/**
 * Create a composite store. The default ordering convention at composition is
 * registry → fs: published capabilities win, legacy FS search remains the
 * fallback. Callers pass an explicit chain to override that convention.
 */
export function createCompositeCapabilityStore(
  opts: CompositeCapabilityStoreOptions = {},
): CompositeCapabilityStore {
  return new CompositeCapabilityStore(opts);
}

