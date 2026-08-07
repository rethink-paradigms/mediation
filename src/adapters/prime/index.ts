/**
 * Prime adapter package surface (composition root / tests import from here).
 * Mirror of adapters/pi/index.ts for the Prime engine slice.
 */

export { PrimeEngineAdapter } from "./engine-adapter.ts";
export type { PrimeEngineAdapterOptions } from "./engine-adapter.ts";
export { PrimeEngineSessionHandle, sessionRefFromPrime } from "./session-handle.ts";
export { mapPrimeEvent } from "./event-map.ts";
export type { MapPrimeEventOptions } from "./event-map.ts";
export {
  extensionPathsFromPackPlan,
  findModel,
  openPrimeSession,
  primeToolsFromPolicy,
} from "./create-session.ts";
export type { PrimeToolsMapping } from "./create-session.ts";
export type {
  PrimeSessionSurface,
  PrimeSessionEvent,
  PrimeSessionFactory,
  OpenedPrimeSession,
} from "./types.ts";
