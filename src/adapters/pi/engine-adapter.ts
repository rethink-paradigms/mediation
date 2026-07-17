/**
 * PiEngineAdapter — EnginePort over real Pi (createAgentSession).
 *
 * One door: createAgentSession only via create-session.ts under adapters/pi.
 * App/domain never import @earendil-works/*.
 *
 * Composition (wiring sketch):
 * ```ts
 * const engine = new PiEngineAdapter(); // live Pi
 * // const engine = new MockEnginePort(); // S2 unit path
 * const factory = new DefaultPresenceFactory({
 *   engine,
 *   toPackSnapshot,
 *   capabilityResolver: createCapabilityResolver(
 *     createFsCapabilityStore({ projectRoot }),
 *   ),
 * });
 * ```
 */

import type {
  EnginePort,
  EngineSessionHandle,
  OpenSessionRequest,
} from "../../ports/engine.ts";
import { asSessionRef } from "../../domain/presence.ts";
import { openPiSession } from "./create-session.ts";
import { PiEngineSessionHandle } from "./session-handle.ts";
import type { PiEngineAdapterOptions, PiSessionFactory } from "./types.ts";

export type { PiEngineAdapterOptions } from "./types.ts";

/**
 * Real engine unit (S2b). Implements EnginePort with Pi on the call path.
 */
export class PiEngineAdapter implements EnginePort {
  private readonly sessionFactory: PiSessionFactory;
  /** Sessions opened (test inspection). */
  readonly opened: EngineSessionHandle[] = [];

  constructor(opts: PiEngineAdapterOptions = {}) {
    this.sessionFactory =
      opts.sessionFactory ??
      ((req) => openPiSession(req, opts));
  }

  async openSession(req: OpenSessionRequest): Promise<EngineSessionHandle> {
    const { session, sessionRefValue } = await this.sessionFactory(req);
    const handle = new PiEngineSessionHandle({
      session,
      sessionRef: asSessionRef(sessionRefValue),
    });
    this.opened.push(handle);
    return handle;
  }
}
