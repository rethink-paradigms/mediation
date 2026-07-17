/**
 * @company/mediation — public surface.
 * S0–S2: types + ports + experimental app factory/presence (mock-first).
 * S2b: real Pi lives under src/adapters/pi/ (import there for composition);
 * not re-exported here so the package door stays EnginePort + factory.
 * Session open for the real engine is confined to that adapter tree.
 *
 * Relative re-exports use `.ts` for strip-types runtime (noEmit package).
 */

export type {
  AgentRef,
  AgentDefinition,
  ModelSpec,
  ToolPolicy,
  EngineSettingsPolicy,
} from "./domain/definition.ts";

export type {
  PackRef,
  PackSource,
  PackLoadPlan,
  PackSnapshot,
  PackDiagnostic,
  PackDiagnosticSeverity,
} from "./domain/packs.ts";

export type {
  SessionRef,
  PresenceStatus,
  EngageInput,
  AttachSurface,
  RunOutcome,
  AgentPresence,
  PresenceFactory,
  MaterializeOptions,
  PresenceEvent,
  InterruptKind,
} from "./domain/presence.ts";
export { asSessionRef } from "./domain/presence.ts";

export type {
  RunId,
  JoinKeys,
  EngagementRecord,
  EngagementStatus,
} from "./domain/engagement.ts";
export { asRunId } from "./domain/engagement.ts";

export type { MediationEvent } from "./domain/events.ts";

export { MediationError } from "./domain/errors.ts";
export type { MediationErrorCode } from "./domain/errors.ts";

export type {
  EnginePort,
  EngineSessionHandle,
  OpenSessionRequest,
  EngineEvent,
  IdleSnapshot,
} from "./ports/engine.ts";

export type {
  RuntimePort,
  DispatchInput,
  DispatchHandle,
  PlanSpec,
  PlanNodeSpec,
  PlanEdgeSpec,
  RuntimeStatus,
} from "./ports/runtime.ts";

export type { JoinStore } from "./ports/join.ts";
export type { DefinitionLoader } from "./ports/definition-loader.ts";
export type {
  PackResolver,
  PackResolveRequest,
  PackResolveOptions,
} from "./ports/pack-resolver.ts";
export { packRequestFromDefinition } from "./ports/pack-resolver.ts";

// --- S2 experimental app surface (mock-first; real Pi deferred) ---
export { DefaultPresenceFactory } from "./app/factory.ts";
export type {
  DefaultPresenceFactoryDeps,
  PackSnapshotFn,
} from "./app/factory.ts";
export { DefaultAgentPresence } from "./app/presence.ts";
export type { DefaultAgentPresenceOptions } from "./app/presence.ts";
export { evaluateSettled, maySettle } from "./app/settled-policy.ts";
export type {
  SettledPolicyInput,
  SettledDecision,
} from "./app/settled-policy.ts";
export {
  MockEnginePort,
  MockEngineSessionHandle,
} from "./adapters/mock/engine-adapter.ts";
export type { MockEngineAdapterOptions } from "./adapters/mock/engine-adapter.ts";
export {
  toPackSnapshot,
  packPlanHash,
} from "./adapters/packs/pack-snapshot.ts";
export {
  PackResolverImpl,
  createPackResolver,
} from "./adapters/packs/resolve-packs.ts";
