/**
 * @company/mediation — public surface.
 * S0–S2: types + ports + experimental app factory/presence (mock-first).
 * S2b: real Pi under src/adapters/pi/ (composition import; not re-exported here).
 * S2c: createPiPresenceFactory in src/adapters/wiring.ts (composition import; not here).
 * S5a: OpenWorkflow RuntimePort + engagement leaf + MemoryJoinStore.
 * S5b: leaf + createPiPresenceFactory (tests; composition via wiring).
 * S5c: registerEngagementWorkflow for OW worker execution.
 * S6: SqliteJoinStore durable join.
 * One door: real engine session open only under adapters/pi.
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

// --- ABS-A1 domain capability types (D5 medium independence) ---
export type {
  CapabilityId,
  CapabilityKind,
  CapabilityOrigin,
  CapabilityRef,
  CapabilityDiagnostic,
  CapabilityDiagnosticSeverity,
  CapabilityPlan,
} from "./domain/capability.ts";
export { asCapabilityId } from "./domain/capability.ts";

// --- ABS-A5 config layers (root · family · agent) pure merge ---
export type {
  ConfigLayerKind,
  CapabilitySpec,
  ConfigLayer,
  EffectiveCapabilitySpec,
} from "./domain/config-layer.ts";
export { mergeCapabilitySpecs } from "./domain/config-layer.ts";

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

// --- ABS-B1 SurfacePort (connectors only; CLI adapter is B2) ---
export type {
  SurfacePort,
  SurfaceRequest,
  SurfaceEngageMode,
  SurfaceEngageResult,
  SurfaceReenterRequest,
  SurfaceReenterResult,
} from "./ports/surface.ts";

// --- ABS-A2 CapabilityStore port (D5 L2; adapters A3/A4/R1) ---
export type {
  CapabilityStore,
  CapabilityPublisher,
  CapabilityArtifact,
  CapabilityEntry,
  CapabilityGetOptions,
  PublishCapabilityInput,
} from "./ports/capability-store.ts";

// --- ABS-R1 RegistryCapabilityStore stub (D5 L5; in-memory, no HTTP) ---
export {
  RegistryCapabilityStore,
  createRegistryCapabilityStore,
} from "./adapters/capability/registry-store.ts";
export type { RegistryCapabilityStoreOptions } from "./adapters/capability/registry-store.ts";

// --- ABS-A3 FsCapabilityStore (D5 L2/L4; FS adapter only) ---
export {
  FsCapabilityStore,
  createFsCapabilityStore,
  resolveFsModule,
} from "./adapters/capability/fs-store.ts";
export type {
  FsCapabilityStoreOptions,
  FsCapabilitySource,
  FsResolvedModule,
} from "./adapters/capability/fs-store.ts";

// --- ABS-B2 Mediation as SurfacePort (CLI uses SurfacePort only) ---
export {
  createMediationSurface,
  MediationSurface,
} from "./adapters/surface/mediation-surface.ts";

// --- S2 experimental app surface (mock-first; real Pi deferred) ---
// CUT: CapabilityResolver is the sole materialize resolve path (D5)
export {
  DefaultPresenceFactory,
  capabilitySpecFromDefinition,
  modulePathFromArtifact,
  packLoadPlanFromCapabilityArtifacts,
} from "./app/factory.ts";
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

// --- S7 Mediation façade (ports only; compose in adapters) ---
export { Mediation } from "./app/mediation.ts";
export type {
  MediationDeps,
  EngageLocalInput,
  EngageLocalResult,
  ReenterInput,
  ReenterResult,
} from "./app/mediation.ts";

// --- ABS-B3 experience recipes (thin Mediation wrappers; D0 P6) ---
export type { Recipe, RecipeContext } from "./app/recipes/types.ts";
export { solo } from "./app/recipes/solo.ts";
export type { SoloInput, SoloResult } from "./app/recipes/solo.ts";
export { reenter } from "./app/recipes/reenter.ts";
export type {
  ReenterRecipeInput,
  ReenterRecipeResult,
} from "./app/recipes/reenter.ts";
export { dispatch } from "./app/recipes/dispatch.ts";
export type {
  DispatchRecipeInput,
  DispatchRecipeResult,
} from "./app/recipes/dispatch.ts";
export { plan } from "./app/recipes/plan.ts";
export type { PlanRecipeInput, PlanRecipeResult } from "./app/recipes/plan.ts";
export {
  createLocalMediation,
  createHostedMediation,
  resolveCapabilityResolver,
} from "./adapters/compose.ts";
export type {
  CreateLocalMediationOptions,
  LocalMediationComposition,
  CreateHostedMediationOptions,
  HostedMediationComposition,
} from "./adapters/compose.ts";
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

// --- S1b YamlDefinitionLoader (inert agent.yaml → AgentDefinition) ---
export {
  YamlDefinitionLoader,
  createYamlDefinitionLoader,
  mapYamlToDefinition,
  loadPromptField,
} from "./adapters/definition/yaml-definition-loader.ts";
export type { YamlDefinitionLoaderOptions } from "./adapters/definition/yaml-definition-loader.ts";

// --- S5a OpenWorkflow RuntimePort + Gamma leaf (orchestration; no Pi) ---
export {
  OpenWorkflowRuntime,
  defaultEngagementWorkflowSpec,
  defaultPlanWorkflowSpec,
} from "./adapters/openworkflow/runtime.ts";
export type {
  OpenWorkflowRuntimeOptions,
  RuntimeOwClient,
  RuntimeBackend,
  WorkflowSpecRef,
  OwWorkflowRunStatus,
} from "./adapters/openworkflow/runtime.ts";
export type {
  EngagementWorkflowInput,
  EngagementWorkflowOutput,
} from "./adapters/openworkflow/types.ts";
export {
  ENGAGEMENT_WORKFLOW_NAME,
  PLAN_WORKFLOW_NAME,
} from "./adapters/openworkflow/types.ts";
export {
  runEngagementLeaf,
} from "./adapters/openworkflow/workflows/engagement.ts";
export type { EngagementLeafDeps } from "./adapters/openworkflow/workflows/engagement.ts";
export {
  registerEngagementWorkflow,
} from "./adapters/openworkflow/register-engagement.ts";
export type {
  EngagementOwClient,
  RegisterEngagementWorkflowDeps,
  RegisterEngagementWorkflowResult,
} from "./adapters/openworkflow/register-engagement.ts";
// --- S10 Plan leaf (sequential PlanSpec via same Gamma engagement leaf) ---
export {
  runPlanWorkflow,
  planNodeToEngagementInput,
  summarizePlanResults,
} from "./adapters/openworkflow/workflows/plan.ts";
export type {
  PlanLeafDeps,
  PlanNodeResult,
  PlanWorkflowOutput,
} from "./adapters/openworkflow/workflows/plan.ts";
export {
  registerPlanWorkflow,
} from "./adapters/openworkflow/register-plan.ts";
export type {
  PlanOwClient,
  RegisterPlanWorkflowDeps,
  RegisterPlanWorkflowResult,
} from "./adapters/openworkflow/register-plan.ts";
// --- ABS-C1 sqlite-only OW RuntimeHost composition ---
export {
  createSqliteRuntimeHost,
} from "./adapters/openworkflow/host.ts";
export type {
  CreateSqliteRuntimeHostOptions,
  SqliteRuntimeHost,
  RuntimeHostWorker,
  RuntimeHostOw,
} from "./adapters/openworkflow/host.ts";
export { MemoryJoinStore } from "./adapters/join/memory-store.ts";
export { SqliteJoinStore } from "./adapters/join/sqlite-store.ts";
export type { SqliteJoinStoreOptions } from "./adapters/join/sqlite-store.ts";

// --- ABS-A4 MemoryCapabilityStore (tests/fixtures; no FS) ---
export { MemoryCapabilityStore } from "./adapters/capability/memory-store.ts";

// --- ABS-A6 CapabilityResolver (merge layers + store.get fail-closed) ---
export type {
  CapabilityResolver,
  CapabilityResolveInput,
  CapabilityResolveResult,
} from "./ports/capability-resolver.ts";
export {
  DefaultCapabilityResolver,
  createCapabilityResolver,
} from "./adapters/capability/resolve.ts";
export type { DefaultCapabilityResolverOptions } from "./adapters/capability/resolve.ts";
