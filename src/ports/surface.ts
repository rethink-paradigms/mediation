/**
 * SurfacePort — how clients connect (CLI / MCP / Pi-ext adapters later).
 * Law D5: surfaces are connectors; this node is port + DTOs only.
 *
 * Layer rule: ports/ must not import app/. Result shapes mirror Mediation
 * engageLocal / reenter / dispatch using domain + RuntimePort types only.
 */

import type { AgentRef } from "../domain/definition.js";
import type { RunId } from "../domain/engagement.js";
import type { RunOutcome, SessionRef } from "../domain/presence.js";
import type { DispatchHandle, RuntimeStatus } from "./runtime.js";

/** Engagement mode aligned with EngageInput / Mediation façade. */
export type SurfaceEngageMode = "prompt" | "continue";

/**
 * Client request into a surface (correlation + engage/dispatch fields).
 * Aligns with EngageLocal / Dispatch where sensible.
 */
export type SurfaceRequest = {
  readonly agent: AgentRef;
  readonly task: string;
  /** Optional cognitive resume handle. */
  readonly resume?: SessionRef;
  readonly mode?: SurfaceEngageMode;
  readonly cwd?: string;
  /** Correlation for join / multi-channel clients. */
  readonly clientRequestId?: string;
  /** Surface channel id (cli, mcp, chat, …). */
  readonly channel?: string;
  /** S9: force Parked outcome after idle (recipe / test). */
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
};

/**
 * Local monocoque engage result — mirrors Mediation.engageLocal without app import.
 */
export type SurfaceEngageResult = {
  readonly outcome: RunOutcome;
  readonly sessionRef?: SessionRef;
  readonly packSnapshotHash?: string;
  readonly definitionId: string;
};

/**
 * Reenter request — rematerialize same sessionRef, optional packSnapshot gate.
 */
export type SurfaceReenterRequest = {
  readonly agent: AgentRef;
  readonly sessionRef: SessionRef;
  readonly task: string;
  readonly mode?: SurfaceEngageMode;
  readonly cwd?: string;
  readonly clientRequestId?: string;
  readonly channel?: string;
  /**
   * If set, fail when rematerialized planHash differs (pack parity).
   */
  readonly expectedPackSnapshotHash?: string;
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
};

/**
 * Reenter result — engage result + pack snapshot gate flag.
 */
export type SurfaceReenterResult = SurfaceEngageResult & {
  /** True when expectedPackSnapshotHash was provided and matched (or omitted). */
  readonly packSnapshotMatch: boolean;
};

/**
 * How clients connect. Adapters (CLI B2, MCP later) implement this face;
 * product monocoque stays behind Mediation / recipes — surfaces stay thin.
 */
export interface SurfacePort {
  engageLocal(req: SurfaceRequest): Promise<SurfaceEngageResult>;
  /** Optional: durable dispatch via RuntimePort (when wired). */
  dispatch?(req: SurfaceRequest): Promise<DispatchHandle>;
  /** Optional: rematerialize + engage (S8 reenter shape). */
  reenter?(req: SurfaceReenterRequest): Promise<SurfaceReenterResult>;
  /** Optional: poll durable run status. */
  getStatus?(runId: RunId): Promise<RuntimeStatus>;
}
