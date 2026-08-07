/**
 * Presence monocoque contract (D1) — interfaces + value shapes only.
 * No engage implementation, no engine vendor types.
 */

import type { AgentDefinition } from "./definition.js";
import type { EngineKind } from "./engine.js";
import type { PackSnapshot } from "./packs.js";

/** Branded durable cognitive artifact id/path. */
export type SessionRef = string & { readonly __brand: "SessionRef" };

export function asSessionRef(value: string): SessionRef {
  return value as SessionRef;
}

export type PresenceStatus =
  | "cold"
  | "warming"
  | "idle"
  | "engaging"
  | "parked"
  | "disposed";

export type EngageInput = {
  readonly text: string;
  readonly images?: readonly unknown[];
  readonly mode?: "prompt" | "continue";
  /**
   * D1/D2 ParkBridge text for continue-after-Parked: the wait contract
   * (whatWasAwaited) + wake payload as a user message. When mode is
   * "continue" the engine handle appends this bridge (or falls back to
   * `text`) so continue is legal after an assistant-final settled park.
   * Pure bridge construction lives in domain/park-bridge.ts.
   */
  readonly bridgeText?: string;
  /**
   * When true after engine idle, engage returns Parked (D1 / S9).
   * Stand-in for wait-tool park detection until tool bridge lands.
   */
  readonly parkIntent?: boolean;
  /** Optional human-readable park reason (default: park_intent). */
  readonly parkReason?: string;
};

/**
 * Observation / UI binding surface. Rebind must not re-resolve packs.
 */
export type AttachSurface =
  | { readonly kind: "none" }
  | { readonly kind: "terminal" }
  | { readonly kind: "chat"; readonly channelId?: string }
  | { readonly kind: "custom"; readonly name: string; readonly data?: unknown };

/**
 * Result of engage (D1). Settled | Parked | Failed.
 */
export type RunOutcome =
  | {
      readonly kind: "settled";
      readonly sessionRef: SessionRef;
      readonly result?: unknown;
    }
  | {
      readonly kind: "parked";
      readonly sessionRef: SessionRef;
      readonly reason: string;
      readonly resumeToken: string;
      readonly payload?: unknown;
    }
  | {
      readonly kind: "failed";
      readonly sessionRef?: SessionRef;
      readonly error: { readonly message: string; readonly code?: string; readonly cause?: unknown };
    };

export type MaterializeOptions = {
  readonly resume?: SessionRef;
  readonly cwd?: string;
  readonly mode?: "headless" | "attached";
  readonly surface?: AttachSurface;
  /**
   * Per-call engine override (S2e). Resolution precedence inside the
   * factory: override > effective config-layer > defaultEngine > "pi".
   */
  readonly engine?: EngineKind;
};

/**
 * Minimal presence/engine event union for observe (full union deferred in D1 §8).
 */
export type PresenceEvent =
  | { readonly type: "status"; readonly status: PresenceStatus }
  | { readonly type: "idle"; readonly at: string }
  | { readonly type: "message"; readonly role: string; readonly text?: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "engine"; readonly name: string; readonly data?: unknown };

export type InterruptKind = "steer" | "followUp" | "abort";

/**
 * Living (or rehydrated) agent presence — product monocoque operations (D1).
 */
export interface AgentPresence {
  readonly id: string;
  readonly definition: AgentDefinition;
  readonly sessionRef: SessionRef;
  readonly packSnapshot: PackSnapshot;
  readonly status: PresenceStatus;

  engage(input: EngageInput): Promise<RunOutcome>;
  interrupt(kind: InterruptKind, payload?: unknown): Promise<void>;
  attach(surface: AttachSurface): Promise<void>;
  detach(): Promise<void>;
  observe(listener: (event: PresenceEvent) => void): () => void;
  dispose(): Promise<void>;
}

/**
 * One door (D0 P1). Implementations construct Presence; surfaces never open sessions.
 */
export interface PresenceFactory {
  materialize(
    definition: AgentDefinition,
    opts?: MaterializeOptions,
  ): Promise<AgentPresence>;
}
