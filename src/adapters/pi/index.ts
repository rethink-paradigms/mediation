/**
 * Pi adapter package surface (composition root / tests import from here).
 * Not re-exported from @company/mediation public index (architecture: no second door).
 */

export { PiEngineAdapter } from "./engine-adapter.ts";
export type { PiEngineAdapterOptions } from "./engine-adapter.ts";
export { PiEngineSessionHandle, sessionRefFromPi } from "./session-handle.ts";
export { mapPiEvent } from "./event-map.ts";
export type { MapPiEventOptions } from "./event-map.ts";
export { openPiSession } from "./create-session.ts";
export type {
  PiSessionSurface,
  PiSessionEvent,
  PiSessionFactory,
  OpenedPiSession,
} from "./types.ts";
