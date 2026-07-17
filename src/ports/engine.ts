/**
 * EnginePort — stable face over Pi (default) or a future engine.
 * Domain never sees AgentSession / vendor types.
 */

import type {
  AgentDefinition,
  EngineSettingsPolicy,
  ToolPolicy,
} from "../domain/definition.js";
import type { PackLoadPlan } from "../domain/packs.js";
import type { SessionRef } from "../domain/presence.js";

export type IdleSnapshot = {
  readonly at: string;
  readonly reason?: string;
};

export type EngineEvent =
  | { readonly type: "idle"; readonly snapshot: IdleSnapshot }
  | { readonly type: "message"; readonly role: string; readonly text?: string }
  | { readonly type: "tool"; readonly name: string; readonly phase: "start" | "end" }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "raw"; readonly name: string; readonly data?: unknown };

export type OpenSessionRequest = {
  readonly definition: AgentDefinition;
  readonly packPlan: PackLoadPlan;
  readonly resume?: SessionRef;
  readonly cwd: string;
  readonly settings: EngineSettingsPolicy;
  readonly tools: ToolPolicy;
};

export interface EngineSessionHandle {
  readonly sessionRef: SessionRef;
  prompt(text: string, images?: readonly unknown[]): Promise<void>;
  continue(): Promise<void>;
  interrupt(
    kind: "steer" | "followUp" | "abort",
    payload?: unknown,
  ): Promise<void>;
  subscribe(listener: (e: EngineEvent) => void): () => void;
  /** Wait until engine reports true idle for settled-gate. */
  waitUntilIdle(opts?: { signal?: AbortSignal }): Promise<IdleSnapshot>;
  dispose(): Promise<void>;
}

export interface EnginePort {
  openSession(req: OpenSessionRequest): Promise<EngineSessionHandle>;
}
