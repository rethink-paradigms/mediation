/**
 * Inert agent definition DTOs — company agent.yaml contract, not Pi settings.
 * No I/O, no vendor types.
 */

import type { EngineKind } from "./engine.ts";

/** Reference to an agent root (name + filesystem root). */
export type AgentRef = {
  readonly name: string;
  readonly rootDir: string;
};

/** Model id as harness string ("provider/model-id") or structured form. */
export type ModelSpec =
  | string
  | {
      readonly provider: string;
      readonly id: string;
    };

/**
 * Tool policy carried on the definition and passed into EnginePort.
 * Aligned with harness AgentConfig.tools + agent_mode/active_tools.
 */
export type ToolPolicy = {
  readonly builtin?: readonly string[];
  readonly custom?: readonly string[];
  /** "dynamic" = only activeTools in context; "static" = all registered. */
  readonly agentMode?: "static" | "dynamic";
  readonly activeTools?: readonly string[];
  /** Engine-level exclude list (adapter maps to Pi exclude). */
  readonly exclude?: readonly string[];
};

/**
 * Engine settings policy — company-facing, not Pi SettingsManager.
 * Adapter maps this into vendor settings (e.g. inMemory).
 */
export type EngineSettingsPolicy = {
  readonly inMemory?: boolean;
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  readonly maxTokens?: number;
  readonly extra?: Readonly<Record<string, unknown>>;
};

/**
 * Resolved inert agent definition (D1).
 * Loaded by DefinitionLoader; never constructs a session.
 * Field set aligned with harness AgentConfig where sensible.
 */
export type AgentDefinition = {
  readonly id: string;
  readonly name: string;
  readonly rootDir: string;
  readonly model: ModelSpec;
  /**
   * Agent's declared engine default (`agent.yaml` key `engine:`).
   * Inert carrier — no I/O, no resolution here. Resolution precedence:
   * per-call override > effective config-layer > composition defaultEngine > "pi".
   */
  readonly engine?: EngineKind;
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  /** Path to .md or inline system prompt text. */
  readonly prompt?: string;
  /** Resolved or declared skill paths / names. */
  readonly skills?: readonly string[];
  /** Extension / pack names as declared (pre-resolve). */
  readonly extensions?: readonly string[];
  readonly tools?: ToolPolicy;
  readonly agentMode?: "static" | "dynamic";
  readonly activeTools?: readonly string[];
  readonly noCoreSkills?: boolean;
  readonly memory?: {
    readonly enabled: boolean;
    readonly namespace?: string;
    readonly recallLimit?: number;
  };
  readonly maxTokens?: number;
  readonly maxCostPerDayUsd?: number;
  readonly maxConcurrency?: number;
  readonly taskTimeoutMinutes?: number;
  /** Optional family extend path (harness extends). */
  readonly extends?: string;
  /** Opaque residual for forward-compatible fields. */
  readonly meta?: Readonly<Record<string, unknown>>;
};
