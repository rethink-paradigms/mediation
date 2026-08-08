/**
 * @company/mediation — public surface.
 *
 * Layer-organized public API. Exports follow the architecture:
 *   Domain → Ports → Adapters → App → Composition
 *
 * PiEngineAdapter and PrimeEngineAdapter are the two engine implementations
 * and are publicly exported for composition (engine selection slices land in
 * a parallel effort — compose.ts / engine-registry). Wire via composition
 * roots (createLocalMediation / createHostedMediation) for the preferred path.
 *
 * Relative re-exports use `.ts` for strip-types runtime (noEmit package).
 */

// ==========================================================================
// DOMAIN LAYER — types that define what the system IS
// ==========================================================================

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

// --- ABS-A1 Capability domain types (D5 medium independence) ---
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

// --- ABS-A5 Config layers (root · family · agent) pure merge ---
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
export { mediationEventFromNotify } from "./domain/events.ts";
export type { NotifyRecordShape } from "./domain/events.ts";

export { MediationError } from "./domain/errors.ts";
export type { MediationErrorCode } from "./domain/errors.ts";

// ==========================================================================
// PORT LAYER — interfaces the system needs (abstract boundaries)
// ==========================================================================

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

// --- ABS-B1 SurfacePort (connectors only; CLI adapter is B2) ---
export type {
  SurfacePort,
  SurfaceRequest,
  SurfaceEngageMode,
  SurfaceEngageResult,
  SurfaceReenterRequest,
  SurfaceReenterResult,
} from "./ports/surface.ts";

// --- SURFACES (issue #3): NotifyPort (D3 P4 first pour) ---
export type {
  NotifyPort,
  ObservableNotifyPort,
  NotifyRecord,
  NotifyEventKind,
} from "./ports/notify.ts";

// --- ABS-A2 CapabilityStore port (D5 L2; adapters A3/A4/R1) ---
export type {
  CapabilityStore,
  CapabilityPublisher,
  CapabilityArtifact,
  CapabilityEntry,
  CapabilityGetOptions,
  PublishCapabilityInput,
} from "./ports/capability-store.ts";

// --- ABS-A6 CapabilityResolver port (merge layers + store.get fail-closed) ---
export type {
  CapabilityResolver,
  CapabilityResolveInput,
  CapabilityResolveResult,
} from "./ports/capability-resolver.ts";

export type { JoinStore } from "./ports/join.ts";
export type { DefinitionLoader } from "./ports/definition-loader.ts";

// ==========================================================================
// ADAPTER LAYER — concrete implementations of ports
// ==========================================================================

// --- ABS-A3 FsCapabilityStore (D5 L2/L4; FS adapter) ---
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

// --- ABS-A4 MemoryCapabilityStore (tests/fixtures; no FS) ---
export { MemoryCapabilityStore } from "./adapters/capability/memory-store.ts";

// --- ABS-R1 RegistryCapabilityStore stub (D5 L5; in-memory, no HTTP) ---
export {
  RegistryCapabilityStore,
  createRegistryCapabilityStore,
} from "./adapters/capability/registry-store.ts";
export type { RegistryCapabilityStoreOptions } from "./adapters/capability/registry-store.ts";

// --- ABS-A6 DefaultCapabilityResolver (merge layers + store.get fail-closed) ---
export {
  DefaultCapabilityResolver,
  createCapabilityResolver,
} from "./adapters/capability/resolve.ts";
export type { DefaultCapabilityResolverOptions } from "./adapters/capability/resolve.ts";

// --- PiEngineAdapter — single real engine implementation ---
export { PiEngineAdapter } from "./adapters/pi/engine-adapter.ts";
export type { PiEngineAdapterOptions } from "./adapters/pi/engine-adapter.ts";

// --- PrimeEngineAdapter — second engine implementation (parallel slice) ---
export { PrimeEngineAdapter } from "./adapters/prime/engine-adapter.ts";
export type { PrimeEngineAdapterOptions } from "./adapters/prime/engine-adapter.ts";
export type {
  PrimeSessionSurface,
  PrimeSessionEvent,
  PrimeSessionFactory,
  OpenedPrimeSession,
} from "./adapters/prime/types.ts";
export { mapPrimeEvent } from "./adapters/prime/event-map.ts";
export type { MapPrimeEventOptions } from "./adapters/prime/event-map.ts";

// --- SURFACES (issue #3): InProcessNotifier (NotifyPort first pour) ---
export { InProcessNotifier } from "./adapters/notify/in-process.ts";
export type { InProcessNotifyListener } from "./adapters/notify/in-process.ts";

// --- ABS-B2 Mediation as SurfacePort (CLI uses SurfacePort only) ---
export {
  createMediationSurface,
  MediationSurface,
} from "./surfaces/mediation-surface.ts";

// --- YamlDefinitionLoader (inert agent.yaml → AgentDefinition) ---
export {
  YamlDefinitionLoader,
  createYamlDefinitionLoader,
  mapYamlToDefinition,
  loadPromptField,
} from "./adapters/definition/yaml-definition-loader.ts";
export type { YamlDefinitionLoaderOptions } from "./adapters/definition/yaml-definition-loader.ts";

// --- OpenWorkflow RuntimePort + engagement leaf ---
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
  runEngagementArc,
  ENGAGEMENT_ARC_MAX_PARK_LOOPS,
} from "./adapters/openworkflow/workflows/engagement-arc.ts";
export type {
  EngagementArcStep,
  EngagementArcDeps,
  RunEngagementArcParams,
} from "./adapters/openworkflow/workflows/engagement-arc.ts";
export {
  ENGAGEMENT_WAKE_KIND,
  engagementSignalName,
  engagementWakeSignal,
  parseWakeSignalData,

} from "./adapters/openworkflow/signals.ts";
export type { WakeSignalData } from "./adapters/openworkflow/signals.ts";
export {
  registerEngagementWorkflow,
} from "./adapters/openworkflow/register-engagement.ts";
export type {
  EngagementOwClient,
  RegisterEngagementWorkflowDeps,
  RegisterEngagementWorkflowResult,
} from "./adapters/openworkflow/register-engagement.ts";

// --- Plan leaf (sequential PlanSpec via same Gamma engagement leaf) ---
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

// --- ABS-C1 Sqlite-only OW RuntimeHost composition ---
export {
  createSqliteRuntimeHost,
} from "./adapters/openworkflow/host.ts";
export type {
  CreateSqliteRuntimeHostOptions,
  SqliteRuntimeHost,
  RuntimeHostWorker,
  RuntimeHostOw,
} from "./adapters/openworkflow/host.ts";

// --- Pack utilities ---
export {
  toPackSnapshot,
  packPlanHash,
} from "./adapters/packs/pack-snapshot.ts";

// --- Join stores ---
export { MemoryJoinStore } from "./adapters/join/memory-store.ts";
export { SqliteJoinStore } from "./adapters/join/sqlite-store.ts";
export type { SqliteJoinStoreOptions } from "./adapters/join/sqlite-store.ts";

// ==========================================================================
// APP LAYER — what the system DOES (orchestration, lifecycle, recipes)
// ==========================================================================

// --- DefaultPresenceFactory + DefaultAgentPresence ---
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

// --- Mediation façade (ports only; compose in adapters) ---
export { Mediation } from "./app/mediation.ts";
export type {
  MediationDeps,
  MediationKnowledgeFace,
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
export { wake } from "./app/recipes/wake.ts";
export type { WakeRecipeInput, WakeRecipeResult } from "./app/recipes/wake.ts";
export { live } from "./app/recipes/live.ts";
export type { LiveRecipeInput, LiveRecipeResult } from "./app/recipes/live.ts";
export { interrupt } from "./app/recipes/interrupt.ts";
export type { InterruptRecipeInput } from "./app/recipes/interrupt.ts";
export { observe } from "./app/recipes/observe.ts";
export type { ObserveRecipeInput, ObserveRecipeResult } from "./app/recipes/observe.ts";

// ==========================================================================
// ENGINE SELECTION (S2e) — runtime engine adapter choice (pi | prime | mock)
// ==========================================================================

export {
  ENGINE_KINDS,
  asEngineKind,
  isEngineKind,
  resolveEngineKind,
} from "./domain/engine.ts";
export type {
  EngineKind,
  EngineResolutionInput,
} from "./domain/engine.ts";
export type { EngineRegistry } from "./ports/engine.ts";
export { createEngineRegistry } from "./adapters/engine-registry.ts";
export type { EngineRegistryOptions } from "./adapters/engine-registry.ts";

// ==========================================================================
// COMPOSITION — how the system is WIRED together
// ==========================================================================

export {
  createLocalMediation,
  createHostedMediation,
  resolveCapabilityResolver,
  resolveHostedJoin,
  defaultHostedJoinPath,
} from "./adapters/compose.ts";
export type {
  CreateLocalMediationOptions,
  LocalMediationComposition,
  CreateHostedMediationOptions,
  HostedMediationComposition,
} from "./adapters/compose.ts";

// ==========================================================================
// DOMAIN-M — capability knowledge-model (issue #2, first pour)
// Pure domain graph + six operations + KnowledgePort + catalog adapters.
// Medium-independent: identities are ids, never paths (D5).
// ==========================================================================

// --- Domain M types + graph + operations (pure, no engine imports) ---
export {
  asCapabilityIdentity,
  isCapabilityIdentity,
  intentText,
  intentWeight,
  intentSuggests,
  CAPABILITY_IDENTITY_PATTERN,
  createGraph,
  findNode,
  requireNode,
  incidentEdges,
  childrenViaGeneralizes,
  outgoingEdges,
  nodesForEngine,
  UnknownCapabilityError,
  listCapabilities,
  describeCapability,
  resolveIntent,
  validateConfig,
  composeCapabilities,
  explainConfig,
  signatureMatchScore,
} from "./domain/knowledge/index.ts";
export type {
  CapabilityIdentity,
  CapabilityValue,
  CapabilityConfig,
  EnumValue,
  CapabilityDomain,
  IntentSignature,
  CapabilityNode,
  EdgeType,
  EdgeCondition,
  CapabilityEdge,
  IncidentEdge,
  GraphMetadata,
  CapabilityGraph,
  ListFilter,
  NodeSummary,
  IntentMatch,
  ResolveOptions,
  ResolveResult,
  ViolationSeverity,
  ValidationViolation,
  ValidationResult,
  EmergentBehavior,
  SideEffect,
  RequiredCapability,
  ComposeResult,
  ExplainStatement,
  ExplainResult,
} from "./domain/knowledge/index.ts";

// --- KnowledgePort (app/surfaces consume this) ---
export type { KnowledgePort, NodeDescription } from "./ports/knowledge.ts";

// --- Catalog adapters (real Pi/Prime/Mock capability graphs) ---
export {
  buildPiCatalog,
  buildPrimeCatalog,
  buildMockCatalog,
  buildCatalog,
  DEFAULT_CATALOG,
} from "./adapters/knowledge/catalog.ts";

// --- KnowledgeService (KnowledgePort implementation) ---
export {
  KnowledgeService,
  createKnowledgeService,
} from "./adapters/knowledge/service.ts";

// Composition slice (issue #4): capability composition
export { CompositeCapabilityStore, createCompositeCapabilityStore } from "./adapters/capability/composite-store.ts";
export type { CompositeCapabilityStoreOptions } from "./adapters/capability/composite-store.ts";
