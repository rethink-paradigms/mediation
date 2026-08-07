/**
 * PrimeEngineAdapter — EnginePort over prime-agent (fork createAgentSession).
 *
 * One door: createAgentSession only via create-session.ts under adapters/prime.
 * App/domain never import prime-agent.
 *
 * Parallel slice to PiEngineAdapter (src/adapters/pi) — same EnginePort face,
 * fork deltas isolated in create-session.ts (ModelRegistry + allowlist tools)
 * and event-map.ts (no agent_settled; idle via waitForIdle).
 */

import type {
  EnginePort,
  EngineSessionHandle,
  OpenSessionRequest,
} from "../../ports/engine.ts";
import { asSessionRef } from "../../domain/presence.ts";
import { openPrimeSession } from "./create-session.ts";
import { PrimeEngineSessionHandle } from "./session-handle.ts";
import type { PrimeEngineAdapterOptions, PrimeSessionFactory } from "./types.ts";

export type { PrimeEngineAdapterOptions } from "./types.ts";

/**
 * Real engine unit (S2b). Implements EnginePort with Prime on the call path.
 */
export class PrimeEngineAdapter implements EnginePort {
  private readonly sessionFactory: PrimeSessionFactory;
  /** Sessions opened (test inspection). */
  readonly opened: EngineSessionHandle[] = [];

  constructor(opts: PrimeEngineAdapterOptions = {}) {
    this.sessionFactory =
      opts.sessionFactory ??
      ((req) => openPrimeSession(req, opts));
  }

  async openSession(req: OpenSessionRequest): Promise<EngineSessionHandle> {
    const { session, sessionRefValue } = await this.sessionFactory(req);
    const handle = new PrimeEngineSessionHandle({
      session,
      sessionRef: asSessionRef(sessionRefValue),
    });
    this.opened.push(handle);
    return handle;
  }
}
