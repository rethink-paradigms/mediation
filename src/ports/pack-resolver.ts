/**
 * PackResolver — pure (preferred sync) resolve → PackLoadPlan.
 * Implementation (PackResolverImpl) is S1 ownership under adapters/packs.
 *
 * Request is intentionally a thin extension-spec list (or AgentDefinition-shaped
 * payload) so resolve stays free of full loader coupling; options carry roots.
 */

import type { AgentDefinition } from "../domain/definition.js";
import type { PackLoadPlan } from "../domain/packs.js";

/**
 * Minimal resolve input: ordered extension/pack names.
 * Callers may pass a full AgentDefinition (which includes extensions) via adapter glue.
 */
export type PackResolveRequest = {
  readonly extensionSpecs: readonly string[];
};

export type PackResolveOptions = {
  readonly projectRoot: string;
};

export interface PackResolver {
  resolve(def: PackResolveRequest, opts: PackResolveOptions): PackLoadPlan;
}

/**
 * Helper: build PackResolveRequest from AgentDefinition.extensions.
 * Not required by the port; kept for app/factory composition later.
 */
export function packRequestFromDefinition(
  def: AgentDefinition,
): PackResolveRequest {
  return { extensionSpecs: def.extensions ?? [] };
}
