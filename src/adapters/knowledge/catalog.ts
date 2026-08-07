/**
 * DOMAIN-M initial capability catalog (issue #2 first pour).
 *
 * Builds a REAL CapabilityGraph from the engine capability surfaces
 * available in this package:
 *   - Pi  : verified against @earendil-works/pi-coding-agent (ThinkingLevel,
 *           ToolName, Model) + research/agent-configuration-knowledge-model/
 *           understanding/pi-sdk-feature-map.md (v0.80.9) + this package's
 *           src/adapters/pi/create-session.ts defaults
 *   - Prime: same surface where the fork truly supports it (verified:
 *           prime-agent uses the same ThinkingLevel and ToolName sets);
 *           nodes the fork cannot express (standalone denylist, no
 *           excludeTools) are engine-scoped to pi
 *   - Mock : in-memory test engine — nominally accepts the same surface
 *
 * Engine scoping is a pure marker on nodes/graph metadata (EngineKind from
 * src/domain/engine.ts); this module imports no engine or vendor code.
 *
 * Fidelity spot-checks (see test/knowledge/fidelity.test.ts):
 *   - m.thinking domain == Pi ThinkingLevel (7 levels, types.d.ts:250)
 *   - m.tools domain == Pi ToolName set (read|bash|edit|write|ls|find|grep)
 *   - m.thinking default "off" == mediation adapter effective default
 *     (create-session.ts: req.settings.thinking ?? req.definition.thinking
 *     ?? "off"); Pi core's own DEFAULT_THINKING_LEVEL is "medium" — the
 *     adapter deliberately overrides for mediation-owned sessions (D2).
 *   - m.tools default [] == adapter noTools:"all" when no allowlist declared
 */

import type { EngineKind } from "../../domain/engine.ts";
import { createGraph } from "../../domain/knowledge/graph.ts";
import type {
  CapabilityEdge,
  CapabilityGraph,
  CapabilityNode,
  GraphMetadata,
  IntentSignature,
} from "../../domain/knowledge/types.ts";
import { asCapabilityIdentity } from "../../domain/knowledge/types.ts";

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

type NodeSeed = Omit<CapabilityNode, "identity"> & { identity: string };

function node(seed: NodeSeed): CapabilityNode {
  return {
    ...seed,
    identity: asCapabilityIdentity(seed.identity),
    intentSignature: [...seed.intentSignature],
  };
}

function sig(text: string, suggests?: string | readonly string[]): IntentSignature {
  return suggests === undefined ? text : { text, suggests };
}

function edge(
  type: CapabilityEdge["type"],
  from: string,
  to: string,
  note: string,
  condition?: CapabilityEdge["condition"],
): CapabilityEdge {
  return {
    type,
    from: asCapabilityIdentity(from),
    to: asCapabilityIdentity(to),
    note,
    ...(condition !== undefined ? { condition } : {}),
  };
}

// absent engineScope == all engines
const PI_ONLY: readonly EngineKind[] = ["pi"];

// ---------------------------------------------------------------------------
// Nodes — Pi capability surface (25 nodes)
// ---------------------------------------------------------------------------

const nodes: CapabilityNode[] = [
  // ---- Model -------------------------------------------------------------
  node({
    identity: "m.model",
    label: "Model",
    description:
      "Which provider/model-id runs the agent (e.g. anthropic/claude-sonnet-4). " +
      "Pi resolves models via ModelRuntime/ModelRegistry (36 built-in providers + custom models.json); " +
      "each Model carries reasoning support, thinkingLevelMap (null = level unsupported), contextWindow, maxTokens, and cost.",
    domain: {
      kind: "free",
      format: "^[^/\\s]+/[^/\\s]+$",
      constraints: ['"provider/model-id" shape', "provider must exist in ModelRegistry (built-in or models.json)"],
    },
    effect: {
      summary:
        "Switches the model mid-session (validates auth, persists to the session tree). Changes context window, " +
        "token costs, response style, and the set of supported thinking levels (levels clamp to the model).",
    },
    intentSignature: [
      "switch model",
      "change the model",
      "use a different model",
      "which model",
      "use claude",
      "use gpt",
    ],
  }),

  // ---- Thinking ----------------------------------------------------------
  node({
    identity: "m.thinking",
    label: "Thinking level",
    description:
      "Reasoning depth of the model. Pi exposes 7 levels (off|minimal|low|medium|high|xhigh|max); higher levels " +
      "reason more thoroughly but are slower and costlier. Levels clamp to the model's supported range " +
      "(Model.thinkingLevelMap, null = unsupported).",
    domain: {
      kind: "enum",
      values: [
        { value: "off", description: "no reasoning tokens — fastest, cheapest, least careful" },
        { value: "minimal", description: "near-zero reasoning — still fast and cheap" },
        { value: "low", description: "light reasoning — quick tasks with modest care" },
        { value: "medium", description: "balanced reasoning depth vs speed/cost" },
        { value: "high", description: "thorough reasoning — careful, slower, costlier" },
        { value: "xhigh", description: "very thorough reasoning for hard problems" },
        { value: "max", description: "maximum reasoning depth — slowest, most expensive" },
      ],
    },
    default: "off",
    defaultRationale:
      "Mediation adapter default (create-session.ts: settings.thinking ?? definition.thinking ?? 'off'). " +
      "Pi core's own DEFAULT_THINKING_LEVEL is 'medium', but the adapter deliberately starts mediation-owned " +
      "sessions at 'off' for speed/cost (D2: mediation-owned settings).",
    effect: {
      summary:
        "Controls reasoning depth. Higher levels: more thorough analysis, better on hard tasks, slower and " +
        "costlier. Lower levels: faster, cheaper, more brittle on complex work.",
      perValue: [
        { value: "off", effect: "no reasoning tokens; direct answers, fastest, cheapest" },
        { value: "minimal", effect: "essentially direct answers with a sliver of reasoning" },
        { value: "low", effect: "light reasoning; fine for well-scoped mechanical tasks" },
        { value: "medium", effect: "balanced depth; the engine's conventional middle" },
        { value: "high", effect: "deliberate reasoning; better on ambiguity and multi-step tasks" },
        { value: "xhigh", effect: "extended reasoning; suited to hard debugging/design" },
        { value: "max", effect: "maximum reasoning; reserve for the hardest problems" },
      ],
    },
    intentSignature: [
      sig("make it more careful", "high"),
      sig("reason deeper", "high"),
      sig("think harder", "high"),
      sig("be more thorough", "high"),
      sig("more thinking", "high"),
      sig("less thinking", "low"),
      sig("keep it quick", "low"),
      sig("faster responses", "low"),
    ],
  }),

  node({
    identity: "m.thinking.budget",
    label: "Thinking budget",
    description:
      "Per-level token caps for reasoning (Pi thinkingBudgets: minimal/low/medium/high). Caps reasoning token " +
      "usage per level to bound cost and response detail.",
    domain: { kind: "range", min: 0, max: 1_000_000, unit: "tokens" },
    effect: {
      summary: "Caps reasoning tokens per thinking level; lower budgets cut cost and response detail.",
    },
    intentSignature: [
      "cap reasoning tokens",
      "limit thinking tokens",
      "thinking budget",
    ],
  }),

  // ---- Tools -------------------------------------------------------------
  node({
    identity: "m.tools",
    label: "Tools (builtin allowlist)",
    description:
      "The set of builtin tools exposed to the agent. Pi's ToolName set is exactly " +
      "read|bash|edit|write|ls|find|grep (pi-coding-agent tools/index.d.ts). In this package the adapter maps " +
      "ToolPolicy.builtin → the engine session's tools allowlist; when NO allowlist is declared the adapter " +
      "sets noTools:'all' — mediation sessions start with ZERO tools.",
    domain: {
      kind: "enum",
      values: [
        // Order mirrors Pi ToolName declaration (tools/index.d.ts):
        // read|bash|edit|write|grep|find|ls
        { value: "read", description: "read files/URLs with truncation" },
        { value: "bash", description: "run shell commands in the session cwd" },
        { value: "edit", description: "targeted file edits" },
        { value: "write", description: "write file contents" },
        { value: "grep", description: "search file contents" },
        { value: "find", description: "locate files by name" },
        { value: "ls", description: "list directory entries" },
      ],
    },
    default: [],
    defaultRationale:
      "Mediation adapter sets noTools:'all' when a definition declares no builtin allowlist " +
      "(src/adapters/pi/create-session.ts) — minimal default surface, agent starts with zero tools.",
    effect: {
      summary:
        "Controls which filesystem/shell operations the agent can perform. Only allowlisted tools are exposed " +
        "to the model. Fewer tools = smaller attack surface and simpler prompts; more tools = more autonomy.",
      perValue: [
        { value: "read", effect: "agent can read files and URLs (truncated)" },
        { value: "bash", effect: "agent can execute shell commands — powerful and risky" },
        { value: "edit", effect: "agent can make targeted edits to existing files" },
        { value: "write", effect: "agent can create/overwrite files" },
        { value: "grep", effect: "agent can search file contents by pattern" },
        { value: "find", effect: "agent can locate files by name/pattern" },
        { value: "ls", effect: "agent can inspect directory contents" },
      ],
    },
    intentSignature: [
      "enable tools",
      "give it tools",
      "which tools",
      "allow it to use tools",
    ],
  }),

  node({
    identity: "m.tools.read",
    label: "Read tool",
    description: "Builtin 'read' tool — reads files and URLs with head/tail truncation.",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "agent may read files/URLs" },
        { value: "disabled", description: "agent may not read files" },
      ],
    },
    default: "disabled",
    categoryValue: "read",
    effect: {
      summary: "Enables reading files/URLs (truncated); the foundation of codebase understanding.",
    },
    intentSignature: [
      sig("let it read files"),
      "read the file",
      "look at the source",
      "read this file",
    ],
  }),

  node({
    identity: "m.tools.bash",
    label: "Bash tool",
    description: "Builtin 'bash' tool — executes shell commands in the session working directory.",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "agent may run shell commands" },
        { value: "disabled", description: "agent may not run shell commands" },
      ],
    },
    default: "disabled",
    categoryValue: "bash",
    effect: {
      summary:
        "Enables shell execution (tests, installs, git, builds). Maximum power and maximum blast radius.",
    },
    intentSignature: [
      "run a command",
      sig("run a command in the terminal"),
      "use the terminal",
      "run the tests",
      "install packages",
      "execute this",
    ],
  }),

  node({
    identity: "m.tools.edit",
    label: "Edit tool",
    description: "Builtin 'edit' tool — targeted edits to existing files.",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "agent may edit existing files" },
        { value: "disabled", description: "agent may not edit files" },
      ],
    },
    default: "disabled",
    categoryValue: "edit",
    effect: {
      summary: "Enables surgical file modification without full rewrites.",
    },
    intentSignature: [
      sig("edit this file"),
      "change this file",
      "fix the bug in this file",
      "modify the code",
    ],
  }),

  node({
    identity: "m.tools.write",
    label: "Write tool",
    description: "Builtin 'write' tool — writes new or full file contents.",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "agent may create/overwrite files" },
        { value: "disabled", description: "agent may not write files" },
      ],
    },
    default: "disabled",
    categoryValue: "write",
    effect: {
      summary: "Enables file creation and full-content writes.",
    },
    intentSignature: [
      sig("write a new file"),
      "create a file",
      "write this out",
      "save this to a file",
    ],
  }),

  node({
    identity: "m.tools.ls",
    label: "Ls tool",
    description: "Builtin 'ls' tool — lists directory entries.",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "agent may list directories" },
        { value: "disabled", description: "agent may not list directories" },
      ],
    },
    default: "disabled",
    categoryValue: "ls",
    effect: {
      summary: "Enables directory inspection — cheap orientation in a repo.",
    },
    intentSignature: [
      "list the directory",
      "what's in this folder",
      "show the files here",
    ],
  }),

  node({
    identity: "m.tools.find",
    label: "Find tool",
    description: "Builtin 'find' tool — locates files by name/pattern.",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "agent may locate files" },
        { value: "disabled", description: "agent may not locate files" },
      ],
    },
    default: "disabled",
    categoryValue: "find",
    effect: {
      summary: "Enables locating files by name across the tree.",
    },
    intentSignature: [
      "find files named",
      "locate the file",
      "where is this file",
    ],
  }),

  node({
    identity: "m.tools.grep",
    label: "Grep tool",
    description: "Builtin 'grep' tool — searches file contents by pattern.",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "agent may search file contents" },
        { value: "disabled", description: "agent may not search contents" },
      ],
    },
    default: "disabled",
    categoryValue: "grep",
    effect: {
      summary: "Enables content search — the narrow-down step before reading.",
    },
    intentSignature: [
      "search for this pattern",
      "find where this is used",
      "grep for",
      "search the codebase",
    ],
  }),

  node({
    identity: "m.tools.custom",
    label: "Custom tools",
    description:
      "User-defined tools callable by the model — registered via the SDK at agent creation or by extensions " +
      "at runtime (pi.registerTool). Each custom tool declares name, description, JSON-schema parameters, and an " +
      "execute function.",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "custom/extension tools may be exposed" },
        { value: "disabled", description: "only builtin tools are exposed" },
      ],
    },
    default: "disabled",
    categoryValue: "custom",
    effect: {
      summary: "Extends the tool surface beyond the 7 builtins with domain-specific operations.",
    },
    intentSignature: [
      "use my custom tool",
      "register a tool",
      "add a custom tool",
    ],
  }),

  node({
    identity: "m.tools.denylist",
    label: "Tool denylist",
    description:
      "Tools to exclude even when otherwise available (Pi excludeTools). Pi-only: the prime fork has no " +
      "excludeTools — exclusion maps to allowlist subtraction, and a standalone exclude is dropped with a WARN " +
      "(src/adapters/prime/create-session.ts primeToolsFromPolicy).",
    domain: { kind: "free", constraints: ["tool names from the builtin set or extension tools"] },
    engineScope: PI_ONLY,
    effect: {
      summary: "Removes named tools from the surface; 'all tools except these'. Allowlist wins when both are declared.",
    },
    intentSignature: [
      "block a tool",
      "disable a tool",
      "exclude this tool",
    ],
  }),

  node({
    identity: "m.tools.notools",
    label: "No-tools mode",
    description:
      "Disable tools entirely ('all' = zero tools) or only the builtin defaults ('builtin' = keep custom and " +
      "extension tools). The mediation adapter sets noTools:'all' implicitly when no allowlist is declared.",
    domain: {
      kind: "enum",
      values: [
        { value: "all", description: "zero tools exposed — pure conversation" },
        { value: "builtin", description: "disable builtin defaults; keep custom/extension tools" },
      ],
    },
    effect: {
      summary: "Removes tool access; the agent can only converse and reason.",
    },
    intentSignature: [
      "no tools",
      "remove all tools",
      "turn off tools",
    ],
  }),

  node({
    identity: "m.tools.execution",
    label: "Tool execution mode",
    description:
      "How tools run: 'sequential' executes one at a time; 'parallel' preflights all then runs allowed ones " +
      "concurrently. Pi default is parallel. Pi-level capability (session.setToolExecution) — not yet surfaced " +
      "through mediation's ToolPolicy/OpenSessionRequest (adapter uses SettingsManager.inMemory({})).",
    domain: {
      kind: "enum",
      values: [
        { value: "sequential", description: "one tool at a time — safer, slower" },
        { value: "parallel", description: "preflight all, run concurrently — faster" },
      ],
    },
    default: "parallel",
    engineScope: PI_ONLY,
    effect: {
      summary: "Trades tool throughput against safety; parallel is faster, sequential is more predictable.",
    },
    intentSignature: [
      "run tools in parallel",
      "sequential tools",
      "tool execution mode",
    ],
  }),

  node({
    identity: "m.tools.agent-mode",
    label: "Agent tool mode",
    description:
      "ToolPolicy.agentMode from this package's definition contract: 'static' keeps all registered tools in " +
      "context; 'dynamic' only includes activeTools (setActiveToolsByName) — a leaner context. Adapter default " +
      "is 'static'.",
    domain: {
      kind: "enum",
      values: [
        { value: "static", description: "all registered tools in context" },
        { value: "dynamic", description: "only activeTools in context" },
      ],
    },
    default: "static",
    effect: {
      summary: "Dynamic mode shrinks the tool prompt surface to the tools actually in use.",
    },
    intentSignature: [
      "dynamic tools",
      "only active tools",
      "tools on demand",
    ],
  }),

  // ---- Resources ---------------------------------------------------------
  node({
    identity: "m.extensions",
    label: "Extensions / packs",
    description:
      "Extension packs (CapabilityId-based in this package) that register tools, commands, providers, and " +
      "flags at runtime. Loaded via additionalExtensionPaths from packPlan (ABS-A8); extension paths resolve " +
      "against the project/agent working directory.",
    domain: { kind: "free", constraints: ["capability ids of extension packs"] },
    effect: {
      summary:
        "Adds runtime capabilities: tools (pi.registerTool), slash commands, providers, flags. Extensions " +
        "compose the agent beyond its builtin surface.",
    },
    intentSignature: [
      "add an extension",
      "install a pack",
      "load extensions",
      "use a plugin",
    ],
  }),

  node({
    identity: "m.skills",
    label: "Skills",
    description:
      "SKILL.md resources injected into the system prompt as context and auto-registered as /skill:name. " +
      "Declared in agent definitions (skills: [...]) and loaded by the resource loader.",
    domain: { kind: "free", constraints: ["skill names available to the resource loader"] },
    effect: {
      summary: "Injects procedural knowledge into the prompt; the agent can invoke skills by name.",
    },
    intentSignature: [
      sig("add a skill"),
      "use skills",
      "load a skill",
    ],
  }),

  node({
    identity: "m.prompt",
    label: "System prompt",
    description:
      "The agent's persona and behavioral contract (system prompt text). Sources: prompt.md, .pi/SYSTEM.md, " +
      "~/.pi/agent/SYSTEM.md, or inline definition prompt.",
    domain: { kind: "free", constraints: ["markdown text"] },
    effect: {
      summary: "Defines who the agent is and how it behaves — the strongest single lever on behavior.",
    },
    intentSignature: [
      "set the system prompt",
      "change its persona",
      "customize the prompt",
      "make it act like",
    ],
  }),

  node({
    identity: "m.context-files",
    label: "Context files (AGENTS.md)",
    description:
      "Auto-discovery of project context files (AGENTS.md) from the working directory up to the filesystem " +
      "root; discovered content is injected into the system prompt.",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "project context files are injected" },
        { value: "disabled", description: "no automatic context file injection" },
      ],
    },
    default: "disabled",
    effect: {
      summary: "Gives the agent standing project context without explicit prompting.",
    },
    intentSignature: [
      "read AGENTS.md",
      "load context files",
      "project context",
    ],
  }),

  // ---- Session / context / transport -------------------------------------
  node({
    identity: "m.compaction",
    label: "Compaction",
    description:
      "Auto-compaction: when context exceeds (contextWindow - reserveTokens), older messages are summarized. " +
      "Pi defaults: enabled, reserveTokens 16384, keepRecentTokens 20000 (docs/compaction.md).",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "old messages are summarized to protect the context window" },
        { value: "disabled", description: "no auto-summarization; long sessions risk overflow" },
      ],
    },
    default: "enabled",
    defaultRationale: "Pi default (docs/compaction.md): enabled with 16384 reserve / 20000 keep-recent tokens.",
    effect: {
      summary:
        "Protects the context window from overflow by summarizing old messages; trades fidelity of early " +
        "context for continuity.",
    },
    intentSignature: [
      "manage context",
      "compact the session",
      "prevent context overflow",
      "stop context overflow",
      "context window management",
    ],
  }),

  node({
    identity: "m.session.cwd",
    label: "Working directory",
    description:
      "The session's working directory (cwd). Values are paths — that is fine: D5 bans paths as IDENTITY, " +
      "not as parameter values. bash runs relative to cwd; context-file discovery starts at cwd.",
    domain: { kind: "free", constraints: ["filesystem directory path (value, not identity)"] },
    effect: {
      summary: "Anchors shell execution, resource discovery, and file tool operations.",
    },
    intentSignature: [
      "work in this directory",
      "set the working directory",
      "run in this folder",
    ],
  }),

  node({
    identity: "m.retry",
    label: "Auto-retry",
    description:
      "Automatic retry of provider errors with exponential backoff. Pi defaults: enabled, 3 retries, 2s base " +
      "delay (docs/settings.md).",
    domain: {
      kind: "enum",
      values: [
        { value: "enabled", description: "provider errors are retried with backoff" },
        { value: "disabled", description: "provider errors surface immediately" },
      ],
    },
    default: "enabled",
    defaultRationale: "Pi default: enabled, maxRetries 3, baseDelayMs 2000 (docs/settings.md).",
    effect: {
      summary: "Improves resilience against transient provider failures at the cost of latency.",
    },
    intentSignature: [
      "retry on errors",
      "automatic retries",
      "retry settings",
    ],
  }),

  node({
    identity: "m.transport",
    label: "Transport mode",
    description:
      "How provider communication streams: auto|sse|websocket|websocket-cached. Pi default auto. " +
      "Pi-level capability (settings) — not yet surfaced through mediation's OpenSessionRequest.",
    domain: {
      kind: "enum",
      values: [
        { value: "auto", description: "engine chooses the best transport" },
        { value: "sse", description: "server-sent events" },
        { value: "websocket", description: "websocket streaming" },
        { value: "websocket-cached", description: "websocket with caching" },
      ],
    },
    default: "auto",
    engineScope: PI_ONLY,
    effect: {
      summary: "Changes streaming behavior and latency characteristics of provider communication.",
    },
    intentSignature: [
      "transport mode",
      "use websocket",
      "streaming transport",
    ],
  }),

  node({
    identity: "m.cache",
    label: "Prompt cache",
    description:
      "Provider-side prompt caching hint: none|short|long. Pi default short (stream options). " +
      "Pi-level capability — not yet surfaced through mediation's OpenSessionRequest.",
    domain: {
      kind: "enum",
      values: [
        { value: "none", description: "no caching hint" },
        { value: "short", description: "short-lived prompt cache" },
        { value: "long", description: "long-lived prompt cache (cheaper repeats)" },
      ],
    },
    default: "short",
    engineScope: PI_ONLY,
    effect: {
      summary: "Trades cache-hint aggressiveness against repeat-request cost.",
    },
    intentSignature: [
      "cache responses",
      "prompt caching",
    ],
  }),
];

// ---------------------------------------------------------------------------
// Edges (36)
// ---------------------------------------------------------------------------

const edges: CapabilityEdge[] = [
  // generalizes: m.tools → its builtin leaves + custom
  edge("generalizes", "m.tools", "m.tools.read", "read is a builtin tool of the tools category (Pi ToolName set)"),
  edge("generalizes", "m.tools", "m.tools.bash", "bash is a builtin tool of the tools category (Pi ToolName set)"),
  edge("generalizes", "m.tools", "m.tools.edit", "edit is a builtin tool of the tools category (Pi ToolName set)"),
  edge("generalizes", "m.tools", "m.tools.write", "write is a builtin tool of the tools category (Pi ToolName set)"),
  edge("generalizes", "m.tools", "m.tools.ls", "ls is a builtin tool of the tools category (Pi ToolName set)"),
  edge("generalizes", "m.tools", "m.tools.find", "find is a builtin tool of the tools category (Pi ToolName set)"),
  edge("generalizes", "m.tools", "m.tools.grep", "grep is a builtin tool of the tools category (Pi ToolName set)"),
  edge("generalizes", "m.tools", "m.tools.custom", "custom tools are the non-builtin member of the tools category"),

  // depends-on
  edge("depends-on", "m.tools.read", "m.tools", "leaf tool declarations are allowlist entries under m.tools (ToolPolicy.builtin)"),
  edge("depends-on", "m.tools.bash", "m.tools", "leaf tool declarations are allowlist entries under m.tools (ToolPolicy.builtin)"),
  edge("depends-on", "m.tools.edit", "m.tools", "leaf tool declarations are allowlist entries under m.tools (ToolPolicy.builtin)"),
  edge("depends-on", "m.tools.write", "m.tools", "leaf tool declarations are allowlist entries under m.tools (ToolPolicy.builtin)"),
  edge("depends-on", "m.tools.ls", "m.tools", "leaf tool declarations are allowlist entries under m.tools (ToolPolicy.builtin)"),
  edge("depends-on", "m.tools.find", "m.tools", "leaf tool declarations are allowlist entries under m.tools (ToolPolicy.builtin)"),
  edge("depends-on", "m.tools.grep", "m.tools", "leaf tool declarations are allowlist entries under m.tools (ToolPolicy.builtin)"),
  edge("depends-on", "m.tools.custom", "m.tools", "custom tool exposure lives under the tools category"),
  edge("depends-on", "m.tools.agent-mode", "m.tools", "dynamic tool activation needs a tool set to activate"),
  edge("depends-on", "m.thinking.budget", "m.thinking", "per-level thinking budgets apply only when a thinking level is configured"),
  edge("depends-on", "m.context-files", "m.session.cwd", "context files (AGENTS.md) are discovered from cwd up to the filesystem root"),
  edge("depends-on", "m.extensions", "m.session.cwd", "extension pack resolution is rooted at the agent's working directory"),

  // affects
  edge("affects", "m.model", "m.thinking", "thinking levels clamp to the model's supported range (Model.thinkingLevelMap; null = unsupported)"),
  edge("affects", "m.model", "m.compaction", "context-window thresholds depend on the model's contextWindow"),
  edge("affects", "m.thinking", "m.compaction", "deeper reasoning consumes more tokens per turn, filling context faster"),
  edge("affects", "m.skills", "m.prompt", "skills are injected into the system prompt as context (auto /skill:name)"),
  edge("affects", "m.context-files", "m.prompt", "AGENTS.md content is injected into the system prompt"),
  edge("affects", "m.extensions", "m.tools", "extensions register tools that appear in the agent's tool set"),
  edge("affects", "m.session.cwd", "m.tools.bash", "bash tool commands execute relative to the session working directory"),

  // composes-with
  edge("composes-with", "m.thinking", "m.model", "some models do not support all thinking levels; the engine clamps to the model's supported range"),
  edge("composes-with", "m.tools.read", "m.tools.grep", "grep narrows, read inspects — together they form a search-then-investigate loop for codebase understanding"),
  edge("composes-with", "m.tools.bash", "m.tools.edit", "edit changes code, bash verifies — together they form an edit-verify loop"),
  edge("composes-with", "m.extensions", "m.tools.custom", "extensions can register custom tools at runtime (pi.registerTool)"),
  edge("composes-with", "m.prompt", "m.skills", "persona (system prompt) + procedures (skills) specialize the agent beyond either alone"),

  // conflicts-with
  edge("conflicts-with", "m.tools", "m.tools.denylist", "declaring both an allowlist and a denylist is contradictory policy; Pi resolves allowlist-first"),
  edge("conflicts-with", "m.tools", "m.tools.notools", "an allowlist and noTools:'all' cannot both hold — zero tools vs a tool list"),
  edge("conflicts-with", "m.tools.denylist", "m.tools.notools", "an exclude list and noTools:'all' cannot both hold"),
  edge(
    "conflicts-with",
    "m.tools.notools",
    "m.extensions",
    "with noTools:'all' every tool is disabled, including extension-registered tools — declaring extensions while disabling all tools is contradictory",
    { on: asCapabilityIdentity("m.tools.notools"), value: "all" },
  ),
];

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

const PI_META: GraphMetadata = {
  name: "pi-capability-catalog",
  version: "0.1.0",
  engine: "pi",
  source:
    "pi-sdk-feature-map.md (Pi SDK v0.80.9) + src/adapters/pi (create-session.ts defaults) + " +
    "src/domain/definition.ts (ToolPolicy.agentMode) + @earendil-works/pi-coding-agent types",
};

const PRIME_META: GraphMetadata = {
  name: "prime-capability-catalog",
  version: "0.1.0",
  engine: "prime",
  source:
    "pi catalog minus nodes the prime fork cannot express (no excludeTools → denylist scoped pi); " +
    "thinking/tools surface verified identical (prime-agent uses pi-core ThinkingLevel + ToolName)",
};

const MOCK_META: GraphMetadata = {
  name: "mock-capability-catalog",
  version: "0.1.0",
  engine: "mock",
  source: "in-memory test engine — nominally accepts the pi surface (thin variant marker)",
};

function catalogFor(meta: GraphMetadata): CapabilityGraph {
  const scopedNodes = nodes.filter(
    (n) => n.engineScope === undefined ||
      (meta.engine !== undefined && n.engineScope.includes(meta.engine)),
  );
  // Drop edges that reference a node not in the scoped set (engine-scoped
  // catalogs must stay internally consistent).
  const scopedIds = new Set(scopedNodes.map((n) => n.identity));
  const scopedEdges = edges.filter((e) => scopedIds.has(e.from) && scopedIds.has(e.to));
  return createGraph(meta, scopedNodes, scopedEdges);
}

/** Full Pi capability catalog (25 nodes / 36 edges on pi). */
export function buildPiCatalog(): CapabilityGraph {
  return catalogFor(PI_META);
}

/** Prime variant — same surface minus pi-scoped nodes (denylist). */
export function buildPrimeCatalog(): CapabilityGraph {
  return catalogFor(PRIME_META);
}

/** Mock variant — thin marker; nominally the full surface. */
export function buildMockCatalog(): CapabilityGraph {
  return catalogFor(MOCK_META);
}

/** Build a catalog for an engine kind (pi | prime | mock). */
export function buildCatalog(engine: EngineKind): CapabilityGraph {
  if (engine === "pi") return buildPiCatalog();
  if (engine === "prime") return buildPrimeCatalog();
  return buildMockCatalog();
}

/** The default catalog used by the KnowledgeService. */
export const DEFAULT_CATALOG: CapabilityGraph = buildPiCatalog();
