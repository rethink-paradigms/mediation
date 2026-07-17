/**
 * Config layers (root · family · agent) → effective capability declaration (ABS-A5).
 * Pure domain merge — no FS, path, or adapter I/O.
 *
 * Layers declare IDs + tool/skill policy. Resolution of IDs to artifacts
 * is CapabilityStore / CapabilityResolver work (later slices).
 */

import {
  asCapabilityId,
  type CapabilityId,
} from "./capability.ts";
import type { ToolPolicy } from "./definition.ts";

/** Provenance of a capability/policy declaration layer. */
export type ConfigLayerKind = "root" | "family" | "agent";

/**
 * Partial capability declaration from one config layer.
 * `extensions` may use branded ids or plain strings (normalized on merge).
 */
export type CapabilitySpec = {
  readonly extensions?: readonly (CapabilityId | string)[];
  /** Partial tool policy; fields merge per v1 rules (see mergeCapabilitySpecs). */
  readonly tools?: Readonly<ToolPolicy>;
  readonly skills?: readonly string[];
};

/** One in-memory layer contribution (no path required). */
export type ConfigLayer = {
  readonly kind: ConfigLayerKind;
  readonly spec: CapabilitySpec;
};

/**
 * Fully merged declaration after applying root → family → agent rules.
 * Always present arrays; `tools` may be an empty object when nothing declared.
 */
export type EffectiveCapabilitySpec = {
  readonly extensions: readonly CapabilityId[];
  readonly tools: ToolPolicy;
  readonly skills: readonly string[];
};

const KIND_ORDER: Readonly<Record<ConfigLayerKind, number>> = {
  root: 0,
  family: 1,
  agent: 2,
};

function orderedUniqueStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function orderedUniqueCapabilityIds(
  items: readonly (CapabilityId | string)[],
): CapabilityId[] {
  return orderedUniqueStrings(items.map(String)).map(asCapabilityId);
}

/**
 * Merge capability specs across config layers (v1, pure).
 *
 * Processing order: `root` → `family` → `agent` (stable within the same kind;
 * input array order among equal kinds is preserved). Layer `kind` is used for
 * ordering; callers may pass layers in any order.
 *
 * Merge rules (v1):
 * - **extensions** — ordered unique union (first occurrence wins position)
 * - **skills** — ordered unique union
 * - **tools.builtin** — ordered unique union
 * - **tools.custom** — ordered unique union (same shape as builtin)
 * - **tools.exclude** — ordered unique union
 * - **tools.agentMode** — later layer overrides earlier
 * - **tools.activeTools** — later layer replaces earlier (not unioned)
 */
export function mergeCapabilitySpecs(
  layers: readonly ConfigLayer[],
): EffectiveCapabilitySpec {
  const sorted = layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => {
      const byKind = KIND_ORDER[a.layer.kind] - KIND_ORDER[b.layer.kind];
      return byKind !== 0 ? byKind : a.index - b.index;
    })
    .map(({ layer }) => layer);

  const extensionAcc: (CapabilityId | string)[] = [];
  const skillAcc: string[] = [];
  const builtinAcc: string[] = [];
  const customAcc: string[] = [];
  const excludeAcc: string[] = [];
  let agentMode: ToolPolicy["agentMode"] | undefined;
  let activeTools: readonly string[] | undefined;

  for (const { spec } of sorted) {
    if (spec.extensions !== undefined) {
      extensionAcc.push(...spec.extensions);
    }
    if (spec.skills !== undefined) {
      skillAcc.push(...spec.skills);
    }
    const tools = spec.tools;
    if (tools === undefined) continue;
    if (tools.builtin !== undefined) {
      builtinAcc.push(...tools.builtin);
    }
    if (tools.custom !== undefined) {
      customAcc.push(...tools.custom);
    }
    if (tools.exclude !== undefined) {
      excludeAcc.push(...tools.exclude);
    }
    if (tools.agentMode !== undefined) {
      agentMode = tools.agentMode;
    }
    if (tools.activeTools !== undefined) {
      activeTools = tools.activeTools;
    }
  }

  const tools: ToolPolicy = {
    ...(builtinAcc.length > 0
      ? { builtin: orderedUniqueStrings(builtinAcc) }
      : {}),
    ...(customAcc.length > 0
      ? { custom: orderedUniqueStrings(customAcc) }
      : {}),
    ...(excludeAcc.length > 0
      ? { exclude: orderedUniqueStrings(excludeAcc) }
      : {}),
    ...(agentMode !== undefined ? { agentMode } : {}),
    ...(activeTools !== undefined ? { activeTools: [...activeTools] } : {}),
  };

  return {
    extensions: orderedUniqueCapabilityIds(extensionAcc),
    tools,
    skills: orderedUniqueStrings(skillAcc),
  };
}
