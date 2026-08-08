/**
 * PrimeEngineSessionHandle — EngineSessionHandle over a prime-agent
 * (fork) AgentSession surface.
 *
 * Thin wrapper: the generic handle logic lives in
 * src/adapters/shared/engine-session-handle.ts (shared with the Pi adapter);
 * only the event mapper (mapPrimeEvent) is Prime-specific.
 *
 * Idle deltas vs Pi:
 * - No agent_settled event exists on the fork. Idle is driven by
 *   session.waitForIdle() (resolves once agent is idle after awaited
 *   agent_end listeners settle); mapAgentEndAsIdle=true also maps agent_end
 *   to idle for subscribe observers.
 */

import type { SessionRef } from "../../domain/presence.ts";
import {
  EngineSessionHandleBase,
  sessionRefFromSurface,
} from "../shared/engine-session-handle.ts";
import { mapPrimeEvent } from "./event-map.ts";
import type { PrimeSessionEvent, PrimeSessionSurface } from "./types.ts";

type PrimeEngineSessionHandleOptions = {
  readonly session: PrimeSessionSurface;
  readonly sessionRef: SessionRef;
  /** Map agent_end as idle (default false — idle via session.waitForIdle). */
  readonly mapAgentEndAsIdle?: boolean;
};

/**
 * EngineSessionHandle backed by real (or fake) Prime session surface.
 *
 * waitUntilIdle:
 * 1. If not streaming and we already observed an idle snapshot → resolve it.
 * 2. Else prefer session.waitForIdle() (fork primary), then snapshot idle.
 * 3. Concurrently listen for mapped idle events via subscribe for observers.
 */
export class PrimeEngineSessionHandle extends EngineSessionHandleBase<PrimeSessionEvent> {
  constructor(opts: PrimeEngineSessionHandleOptions) {
    super({
      session: opts.session,
      sessionRef: opts.sessionRef,
      mapAgentEndAsIdle: opts.mapAgentEndAsIdle,
      label: "PrimeEngineSessionHandle",
      mapEvent: (pe) =>
        mapPrimeEvent(pe, { mapAgentEndAsIdle: opts.mapAgentEndAsIdle === true }),
    });
  }
}

/** Build SessionRef from Prime session file path or id. */
export function sessionRefFromPrime(session: PrimeSessionSurface): SessionRef {
  return sessionRefFromSurface(session);
}
