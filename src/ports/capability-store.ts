/**
 * CapabilityStore — resolve capability ids to artifacts (D5 L2 / ABS-A2).
 * Law D5: identity is id (+ optional version), never a filesystem path.
 *
 * Layer rule: ports/ must not import app/ or adapters/.
 * Implementations (FS / memory / registry) land in adapters later (A3/A4/R1).
 */

import type {
  CapabilityId,
  CapabilityRef,
} from "../domain/capability.js";

/**
 * Opaque payload kinds for a resolved capability.
 * Medium-specific details (paths, registry URLs) stay in entry or ref.locator —
 * not in CapabilityId identity.
 */
export type CapabilityEntry =
  | {
      readonly kind: "module-path";
      /** Adapter-resolved module location; not domain identity. */
      readonly modulePath: string;
    }
  | {
      readonly kind: "bytes";
      readonly bytes: Uint8Array;
      readonly contentType?: string;
    }
  | {
      readonly kind: "inline";
      readonly value: unknown;
    };

/**
 * Resolved capability: canonical ref + entry payload.
 */
export type CapabilityArtifact = {
  readonly ref: CapabilityRef;
  readonly entry: CapabilityEntry;
};

export type CapabilityGetOptions = {
  readonly version?: string;
};

/**
 * Fetch by stable id. Returns null when unknown (callers fail-closed via plan).
 */
export interface CapabilityStore {
  get(
    id: CapabilityId,
    opts?: CapabilityGetOptions,
  ): Promise<CapabilityArtifact | null>;
}

/**
 * Optional publisher face (D5 L5). Builder agents write into a store/registry.
 * Stub only — no cloud/registry adapter here (R1).
 */
export type PublishCapabilityInput = {
  readonly ref: CapabilityRef;
  readonly entry: CapabilityEntry;
};

export interface CapabilityPublisher {
  publish(input: PublishCapabilityInput): Promise<CapabilityRef>;
}
