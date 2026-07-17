/**
 * DefaultCapabilityResolver — mergeCapabilitySpecs + CapabilityStore.get (ABS-A6).
 *
 * For each effective.extensions id: store.get(id).
 * Missing → diagnostic level "error", code "capability_not_found" (fail-closed).
 * Does not wire factory (A7).
 */

import type {
  CapabilityDiagnostic,
  CapabilityPlan,
  CapabilityRef,
} from "../../domain/capability.ts";
import {
  mergeCapabilitySpecs,
  type EffectiveCapabilitySpec,
} from "../../domain/config-layer.ts";
import type {
  CapabilityResolveInput,
  CapabilityResolveResult,
  CapabilityResolver,
} from "../../ports/capability-resolver.ts";
import type { CapabilityStore } from "../../ports/capability-store.ts";

export type DefaultCapabilityResolverOptions = {
  readonly store: CapabilityStore;
};

/**
 * Resolve effective spec from input: layers merge when provided, else
 * pre-merged effective, else empty merge.
 */
function resolveEffective(
  input: CapabilityResolveInput,
): EffectiveCapabilitySpec {
  if (input.layers !== undefined) {
    return mergeCapabilitySpecs(input.layers);
  }
  if (input.effective !== undefined) {
    return input.effective;
  }
  return mergeCapabilitySpecs([]);
}

export class DefaultCapabilityResolver implements CapabilityResolver {
  private readonly store: CapabilityStore;

  constructor(opts: DefaultCapabilityResolverOptions) {
    this.store = opts.store;
  }

  async resolve(
    input: CapabilityResolveInput,
  ): Promise<CapabilityResolveResult> {
    const effective = resolveEffective(input);
    const capabilities: CapabilityRef[] = [];
    const diagnostics: CapabilityDiagnostic[] = [];

    for (const id of effective.extensions) {
      const artifact = await this.store.get(id);
      if (artifact === null) {
        diagnostics.push({
          level: "error",
          code: "capability_not_found",
          message: `Capability not found: "${id}"`,
          capabilityId: id,
        });
        continue;
      }
      capabilities.push(artifact.ref);
    }

    const ok = !diagnostics.some((d) => d.level === "error");
    const plan: CapabilityPlan = {
      capabilities,
      diagnostics,
      ok,
    };

    return {
      effective,
      plan,
      diagnostics,
    };
  }
}

export function createCapabilityResolver(
  store: CapabilityStore,
): CapabilityResolver {
  return new DefaultCapabilityResolver({ store });
}
