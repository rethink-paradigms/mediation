/**
 * PiEngineSessionHandle — EngineSessionHandle over a Pi AgentSession surface.
 *
 * Thin wrapper: the generic handle logic lives in
 * src/adapters/shared/engine-session-handle.ts (shared with the Prime adapter);
 * only the event mapper (mapPiEvent) is Pi-specific.
 */

import type { SessionRef } from "../../domain/presence.ts";
import {
  EngineSessionHandleBase,
  sessionRefFromSurface,
} from "../shared/engine-session-handle.ts";
import { mapPiEvent } from "./event-map.ts";
import type { PiSessionEvent, PiSessionSurface } from "./types.ts";

export type PiEngineSessionHandleOptions = {
  readonly session: PiSessionSurface;
  readonly sessionRef: SessionRef;
  /** Map agent_end(willRetry=false) as idle (default false). */
  readonly mapAgentEndAsIdle?: boolean;
};

/**
 * EngineSessionHandle backed by real (or fake) Pi session surface.
 *
 * waitUntilIdle:
 * 1. If not streaming and we already observed agent_settled → resolve last idle.
 * 2. Else prefer session.waitForIdle() (Pi 0.80+), then snapshot idle.
 * 3. Concurrently listen for agent_settled via subscribe for observers.
 */
export class PiEngineSessionHandle extends EngineSessionHandleBase<PiSessionEvent> {
  constructor(opts: PiEngineSessionHandleOptions) {
    super({
      session: opts.session,
      sessionRef: opts.sessionRef,
      mapAgentEndAsIdle: opts.mapAgentEndAsIdle,
      label: "PiEngineSessionHandle",
      mapEvent: (pe) =>
        mapPiEvent(pe, { mapAgentEndAsIdle: opts.mapAgentEndAsIdle === true }),
    });
  }
}

/** Build SessionRef from Pi session file path or id. */
export function sessionRefFromPi(session: PiSessionSurface): SessionRef {
  return sessionRefFromSurface(session);
}
