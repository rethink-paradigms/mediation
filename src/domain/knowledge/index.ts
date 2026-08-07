/**
 * DOMAIN-M knowledge model — pure domain barrel.
 * No engine/vendor imports; medium-independent capability graph (D5).
 */

export {
  asCapabilityIdentity,
  isCapabilityIdentity,
  intentText,
  intentWeight,
  intentSuggests,
  CAPABILITY_IDENTITY_PATTERN,
} from "./types.ts";
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
} from "./types.ts";

export {
  createGraph,
  findNode,
  requireNode,
  incidentEdges,
  childrenViaGeneralizes,
  outgoingEdges,
  nodesForEngine,
  UnknownCapabilityError,
} from "./graph.ts";

export {
  listCapabilities,
  describeCapability,
  resolveIntent,
  validateConfig,
  composeCapabilities,
  explainConfig,
  signatureMatchScore,
} from "./operations.ts";
