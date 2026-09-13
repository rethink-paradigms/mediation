/**
 * FLEET CATALOG (phase 2 — catalog accuracy) — teaches the Domain-M knowledge
 * catalog the company fleet.
 *
 * The pure engine catalogs (src/adapters/knowledge/catalog.ts) describe WHAT
 * can be configured on an engine (25 m.* nodes). This module adds WHO can be
 * dispatched: one `agent.<name>` node per fleet agent (company/agents/<name>/agent.yaml),
 * each carrying an AgentRef so resolveIntent → agentFor → AgentRef → engage
 * resolves to a real company agent.
 *
 * Design (curated + generative):
 *   - FLEET_MANIFEST pins label / description / intent signatures for the
 *     ~14 agents the human actually dispatches (web-researcher, brain-explorer,
 *     coding-agent, …). Hand-curated so "dispatch our web researcher" resolves.
 *   - Every other fleet agent is DERIVED at build time from its agent.yaml:
 *     description = yaml.description → prompt file first lines → name template;
 *     intent signatures = name phrases + custom-tool phrases. A directory with
 *     an agent.yaml that is not in the manifest is added generatively, so the
 *     catalog tracks the fleet without hand-edits.
 *   - D5 medium independence: node identities are ids (`agent.<name>`), never
 *     filesystem paths. rootDir lives only inside AgentRef (a resolution VALUE,
 *     exactly like m.session.cwd accepts paths as parameter values).
 *
 * The adapter may read disk (adapters layer); the domain graph stays pure.
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { DEFAULT_CATALOG } from "./catalog.ts";
import { createGraph } from "../../domain/knowledge/graph.ts";
import type {
  CapabilityGraph,
  CapabilityNode,
  GraphMetadata,
  IntentSignature,
} from "../../domain/knowledge/types.ts";
import { asCapabilityIdentity } from "../../domain/knowledge/types.ts";
import type { AgentRef } from "../../domain/definition.ts";

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

/**
 * One fleet agent in the curated manifest. `dir` defaults to `name` (all
 * fleet agents are direct subdirectories of the agents root). Missing
 * `label` / `description` / `intentSignature` are auto-derived at build time
 * from the agent's agent.yaml (+ prompt file) — curation is an override, not
 * a requirement.
 */
export type FleetAgentManifestEntry = {
  readonly name: string;
  /** Directory under the agents root (default: name). */
  readonly dir?: string;
  readonly label?: string;
  readonly description?: string;
  readonly intentSignature?: readonly IntentSignature[];
};

// ---------------------------------------------------------------------------
// Curated entries — the agents the human actually dispatches
// ---------------------------------------------------------------------------

const CURATED: readonly FleetAgentManifestEntry[] = [
  {
    name: "web-researcher",
    label: "Web Researcher",
    description:
      "Finds high-quality conceptual knowledge — architectural patterns, design decisions, industry " +
      "analysis, organizational insights — from blog posts, company documentation, articles, case " +
      "studies, talks, and analysis pieces across the broader web. Explicitly NOT code-implementation " +
      "hunting (that is lego-researcher).",
    intentSignature: [
      "web research",
      "search the web",
      "research online",
      "find articles and analysis",
      "look this up on the web",
      "dispatch our web researcher",
      "web researcher",
      "find conceptual knowledge",
    ],
  },
  {
    name: "brain-explorer",
    label: "Brain Explorer",
    description:
      "Navigates the company brain database directly (sessions, episodes, recaps, decisions, entities, " +
      "connections) using brain tools. Answers \"what do we know about X\" from accumulated company " +
      "history; explores, never delegates.",
    intentSignature: [
      "explore the brain",
      "brain database",
      "what do we know about",
      "look up our history",
      "brain explorer",
      "search company memory",
      "recap sessions",
    ],
  },
  {
    name: "coding-agent",
    label: "Coding Agent",
    description:
      "Writes correct code in files: orients to the codebase, plans surgical changes, edits, validates " +
      "with lint and tests, and reports the result. The fleet's implementation worker.",
    intentSignature: [
      "write code",
      "implement this",
      "fix the bug",
      "make the change in the codebase",
      "code it up",
      "coding agent",
      "edit the code",
      "write the implementation",
    ],
  },
  {
    name: "intel-researcher",
    label: "Intel Researcher",
    description:
      "Tracked intelligence agent: works from a curated registry of known targets (companies, projects, " +
      "frameworks, founders), deep-reads known sources, and produces a design proposal with concrete " +
      "architecture, key decisions, and trade-off analysis. Bridge between external intelligence and " +
      "internal engineering.",
    intentSignature: [
      "intel research",
      "competitive intelligence",
      "deep dive on a target",
      "intel researcher",
      "registry research",
      "intelligence on a known target",
    ],
  },
  {
    name: "lego-researcher",
    label: "Lego Researcher",
    description:
      "Finds battle-tested solutions from real-world codebases — production-grade implementations or " +
      "entire open-source repos — via web search and GitHub tools. The 'lego pieces' hunter for code " +
      "implementation patterns.",
    intentSignature: [
      "lego research",
      "find code implementations",
      "github research",
      "real-world code examples",
      "lego pieces",
      "battle-tested implementations",
      "lego researcher",
    ],
  },
  {
    name: "session-analyst",
    label: "Session Analyst",
    description:
      "Exploratory behavioral analysis across the fleet of agents from session traces: gap analysis, " +
      "debugging agent failures, forming hypotheses and testing them against evidence. A detective, not " +
      "a clerk.",
    intentSignature: [
      "analyze sessions",
      "session analysis",
      "investigate agent behavior",
      "debug agent failures",
      "session analyst",
      "analyze the fleet sessions",
      "gap analysis",
    ],
  },
  {
    name: "pi-agent-designer",
    label: "Pi Agent Designer",
    description:
      "The company's cognitive architect: designs how agents think — epistemic stance, reasoning arc, " +
      "failure modes, character — through a 3-round consultation workflow. Does not build agents (that " +
      "is coding-agent / pi-tool-builder) and does not research the world (that is web-researcher / " +
      "intel-researcher).",
    intentSignature: [
      "design an agent",
      "agent designer",
      "consultation",
      "how should this agent think",
      "design the cognitive character",
      "pi agent designer",
      "design a new agent",
    ],
  },
  {
    name: "storyline-agent",
    label: "Storyline Agent",
    description:
      "Reconstructs how an agent, project, or human–system relationship came to be — the narrative arc " +
      "from traces and sessions. Turns raw history into a story of origins and evolution.",
    intentSignature: [
      "storyline",
      "narrative of how this came to be",
      "reconstruct the story",
      "how did this agent come to be",
      "storyline agent",
      "origin story",
    ],
  },
  {
    name: "cognitive-cartographer",
    label: "Cognitive Cartographer",
    description:
      "Reconstructs how a mind moved through ideas — not what was concluded, but how it was thought — " +
      "from verbatim user messages in session traces. Renders voice-preserved cognitive maps (Gingko " +
      "column-trees).",
    intentSignature: [
      "cognitive map",
      "map how i thought",
      "cartographer",
      "thought mapping",
      "cognitive cartographer",
      "how did my thinking move",
    ],
  },
  {
    name: "yt-researcher",
    label: "YouTube Researcher",
    description:
      "YouTube research agent: searches, browses, and discovers videos via native YouTube tools, fetches " +
      "transcripts, and organizes an archive. Orchestrator and archivist — decides which videos matter " +
      "and categorizes them; does not analyze transcripts.",
    intentSignature: [
      "youtube research",
      "find videos",
      "video transcripts",
      "yt researcher",
      "youtube discovery",
      "search youtube",
    ],
  },
  {
    name: "email",
    label: "Email Agent",
    description:
      "Executive assistant for email across the company aliases (info@, team@, hello@rethinkparadigms.com): " +
      "pull, query, read, thread, send, reply, flag. Triage, summarize, draft, send.",
    intentSignature: [
      "check email",
      "send an email",
      "draft a reply",
      "email agent",
      "manage email",
      "triage inbox",
    ],
  },
  {
    name: "product-researcher",
    label: "Product Researcher",
    description:
      "Free-range competitive intelligence agent: given any company, product, or URL, produces a deep " +
      "structured competitive brief — what they built, how they think, what they got right, where the " +
      "cracks are, and what it means for us.",
    intentSignature: [
      "product research",
      "competitive brief",
      "analyze a company",
      "product researcher",
      "competitive analysis",
      "research a competitor",
    ],
  },
  {
    name: "visual-cortex",
    label: "Visual Cortex",
    description:
      "Renders concepts to the browser — takes ideas and produces visual artifacts (SVG, diagrams, " +
      "rendered scenes) so the human can see them.",
    intentSignature: [
      "render a concept",
      "visualize this",
      "make a visual",
      "visual cortex",
      "render a diagram",
      "show me visually",
    ],
  },
  {
    name: "notion",
    label: "Notion Agent",
    description:
      "Notion workspace management — reads and updates the company's Notion pages, databases, and " +
      "documentation.",
    intentSignature: [
      "notion",
      "update my notes",
      "notion workspace",
      "manage notion",
      "notion pages",
    ],
  },
];

// ---------------------------------------------------------------------------
// Auto entries — the rest of the fleet (derived at build time from agent.yaml)
// ---------------------------------------------------------------------------

const AUTO: readonly FleetAgentManifestEntry[] = [
  { name: "av-agent" },
  { name: "canvas-tester" },
  { name: "character-generator" },
  { name: "coding-agent-v2" },
  { name: "cognitive-compressor" },
  { name: "cognitive-loop" },
  { name: "company-explorer" },
  { name: "corpus-analyst" },
  { name: "corpus-builder" },
  { name: "corpus-consultant" },
  { name: "doc-onboarder" },
  { name: "dyadic-weaver" },
  { name: "fork-ui-resonance-navigator" },
  { name: "fork-ui-resonance-reviewer" },
  { name: "inference-agent" },
  { name: "knowledge-weaver" },
  { name: "layout-agent" },
  { name: "lego-researcher-v2" },
  { name: "maturity-concept" },
  { name: "maturity-iat" },
  { name: "maturity-narrative" },
  { name: "maturity-tacit" },
  { name: "mediator-agent" },
  { name: "meta-agent" },
  { name: "mirror-agent" },
  { name: "model-intelligence" },
  { name: "openworkflow-agent" },
  { name: "pi-extension-researcher" },
  { name: "pi-sdk-builder" },
  { name: "pi-tool-builder" },
  { name: "planning-agent" },
  { name: "priority-agent" },
  { name: "process-pattern-extractor" },
  { name: "session-screener" },
  { name: "skills-agent" },
  { name: "stitch-agent" },
  { name: "strategy-agent" },
  { name: "surface-agent" },
  { name: "theory-translator" },
  { name: "tool-onboarder" },
  { name: "tool-tester" },
  { name: "ui-agent" },
  { name: "web-researcher-v2" },
];

/**
 * The full curated fleet manifest (57 entries). The node SET is always the
 * union of this manifest and whatever agent.yaml directories exist on disk;
 * curation only upgrades label/description/intents for the key agents.
 */
export const FLEET_MANIFEST: readonly FleetAgentManifestEntry[] = [
  ...CURATED,
  ...AUTO,
];

// ---------------------------------------------------------------------------
// Fleet root resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the fleet agents root (directory containing agent.yaml dirs).
 * Precedence: explicit option > COMPANY_AGENTS_DIR env > company convention
 * (<company>/agents resolved from this module's location — mediation lives at
 * <company>/product/mediation-engine/mediation, so the company root is 6 levels up from
 * src/adapters/knowledge). Returns undefined when no existing root is found
 * (graceful: the default knowledge catalog then stays engine-only, which is
 * exactly today's behavior).
 */
export function resolveFleetAgentsRoot(
  opts: { readonly agentsRoot?: string } = {},
): string | undefined {
  // Explicit option wins absolutely: a provided-but-missing root means "no
  // fleet" (engine-only), never a silent fallback to env/convention — an
  // explicit intent must not be overridden by an ambient root.
  if (opts.agentsRoot !== undefined) {
    return opts.agentsRoot.length > 0 && fs.existsSync(opts.agentsRoot)
      ? path.resolve(opts.agentsRoot)
      : undefined;
  }
  const candidates: string[] = [
    ...(process.env.COMPANY_AGENTS_DIR !== undefined &&
    process.env.COMPANY_AGENTS_DIR.length > 0
      ? [process.env.COMPANY_AGENTS_DIR]
      : []),
    path.resolve(import.meta.dirname, "../../../../../..", "agents"),
  ];
  for (const c of candidates) {
    if (c.length > 0 && fs.existsSync(c)) {
      return path.resolve(c);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Disk enrichment (best-effort — never fails the catalog build)
// ---------------------------------------------------------------------------

type FleetDiskInfo = {
  readonly description?: string;
  readonly promptFirstLines?: string;
  readonly model?: string;
  readonly customTools: readonly string[];
  readonly builtinTools: readonly string[];
  readonly extensions: readonly string[];
};

/** Read one agent directory: agent.yaml fields + prompt-file first lines. */
function readAgentDisk(agentDir: string): FleetDiskInfo {
  let yaml: Record<string, unknown> = {};
  try {
    const raw = parseYaml(fs.readFileSync(path.join(agentDir, "agent.yaml"), "utf8"));
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      yaml = raw as Record<string, unknown>;
    }
  } catch {
    // malformed agent.yaml — node still derives from manifest/template
  }

  const description =
    typeof yaml.description === "string" && yaml.description.trim().length > 0
      ? yaml.description.trim()
      : undefined;

  const toolsRaw = yaml.tools;
  const tools =
    typeof toolsRaw === "object" && toolsRaw !== null && !Array.isArray(toolsRaw)
      ? (toolsRaw as Record<string, unknown>)
      : {};
  const customTools = Array.isArray(tools.custom)
    ? tools.custom.filter((t): t is string => typeof t === "string")
    : [];
  const builtinTools = Array.isArray(tools.builtin)
    ? tools.builtin.filter((t): t is string => typeof t === "string")
    : [];
  const extensions = Array.isArray(yaml.extensions)
    ? yaml.extensions.filter((e): e is string => typeof e === "string")
    : [];
  const model = typeof yaml.model === "string" ? yaml.model : undefined;

  const promptRef = typeof yaml.prompt === "string" ? yaml.prompt : undefined;
  const promptFirstLines = readPromptFirstLines(agentDir, promptRef);

  return { description, promptFirstLines, model, customTools, builtinTools, extensions };
}

/** First prose lines of the agent's prompt file (or a conventional one). */
function readPromptFirstLines(
  agentDir: string,
  promptRef: string | undefined,
): string | undefined {
  const candidates: string[] = [];
  if (promptRef !== undefined) {
    candidates.push(
      promptRef.endsWith(".md") || promptRef.endsWith(".txt")
        ? path.resolve(agentDir, promptRef)
        : path.join(agentDir, "prompt.md"),
    );
  }
  for (const fallback of ["prompt.md", "spec.md", "README.md"]) {
    candidates.push(path.join(agentDir, fallback));
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const lines = fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/u)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));
      if (lines.length === 0) continue;
      const prose = lines.slice(0, 2).join(" ").replaceAll("**", "");
      if (prose.length >= 12) return truncate(prose, 320);
    } catch {
      // unreadable prompt file — skip
    }
  }
  return undefined;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// Derivation (label / description / intents)
// ---------------------------------------------------------------------------

/** "web-researcher" → "Web Researcher"; "av-agent" → "Av Agent". */
export function humanizeAgentName(name: string): string {
  return name
    .replaceAll("-", " ")
    .replaceAll(/\b\w/gu, (c) => c.toUpperCase());
}

/** Auto intent signatures: name phrases + custom-tool phrases. */
function autoIntentSignatures(
  name: string,
  customTools: readonly string[],
): IntentSignature[] {
  const words = name.replaceAll("-", " ");
  const sigs: string[] = [
    words,
    `${words} agent`,
    `use the ${name} agent`,
    `dispatch ${name}`,
  ];
  for (const tool of customTools) {
    const phrase = tool.replaceAll("_", " ");
    sigs.push(phrase, `use ${phrase}`);
  }
  return [...new Set(sigs)];
}

function deriveDescription(
  name: string,
  label: string,
  disk: FleetDiskInfo,
  curated: FleetAgentManifestEntry | undefined,
): string {
  if (curated?.description !== undefined) return curated.description;
  if (disk.description !== undefined) return disk.description;
  if (disk.promptFirstLines !== undefined) return disk.promptFirstLines;
  const parts = [`Fleet agent '${name}' — dispatches the company ${label}.`];
  if (disk.model !== undefined) parts.push(`Model: ${disk.model}.`);
  if (disk.customTools.length > 0) {
    parts.push(`Custom tools: ${disk.customTools.join(", ")}.`);
  }
  if (disk.extensions.length > 0) {
    parts.push(`Extensions: ${disk.extensions.join(", ")}.`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Node + catalog builders
// ---------------------------------------------------------------------------

/** Build one agent node from manifest curation + disk derivation. */
export function buildFleetNode(
  entry: FleetAgentManifestEntry,
  disk: FleetDiskInfo,
  agentsRoot: string,
): CapabilityNode {
  const name = entry.name;
  const label = entry.label ?? humanizeAgentName(name);
  const identity = `agent.${name}`;
  const rootDir = path.join(agentsRoot, entry.dir ?? name);
  const agentRef: AgentRef = { name, rootDir };

  return {
    identity: asCapabilityIdentity(identity),
    label,
    description: deriveDescription(name, label, disk, entry),
    domain: {
      kind: "free",
      constraints: [
        "fleet agent — resolved via agentFor to an AgentRef for definition load / engagement",
      ],
    },
    effect: {
      summary:
        `Selects the fleet agent '${name}'; agentFor resolves it to ` +
        `{ name: '${name}', rootDir } which the DefinitionLoader can load for engage/dispatch.`,
    },
    intentSignature:
      entry.intentSignature ?? autoIntentSignatures(name, disk.customTools),
    agentRef,
  };
}

const FLEET_META: GraphMetadata = {
  name: "fleet-catalog",
  version: "0.1.0",
  source:
    "company/agents/*/agent.yaml (fleet manifest: curated for ~14 dispatched agents; " +
    "auto-derived for the rest) + prompt-file first lines",
};

/**
 * Build the fleet catalog (agent.<name> nodes) from an agents root.
 * Generative: every directory under the root that contains an agent.yaml
 * becomes a node — manifest entries get curated overrides, unknown agents
 * are derived purely from disk (so the catalog tracks the fleet without
 * hand-edits). When no agents root resolves, returns an EMPTY fleet graph
 * (graceful — the default knowledge catalog then stays engine-only).
 */
export function buildFleetCatalog(
  opts: { readonly agentsRoot?: string } = {},
): CapabilityGraph {
  const root = resolveFleetAgentsRoot(opts);
  if (root === undefined) {
    return createGraph(FLEET_META, [], []);
  }

  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        !d.name.startsWith(".") &&
        fs.existsSync(path.join(root, d.name, "agent.yaml")),
    )
    .map((d) => d.name)
    .sort();

  const manifestByName = new Map(FLEET_MANIFEST.map((e) => [e.name, e]));
  const nodes: CapabilityNode[] = [];
  for (const dir of dirs) {
    const disk = readAgentDisk(path.join(root, dir));
    const entry = manifestByName.get(dir) ?? { name: dir };
    nodes.push(buildFleetNode(entry, disk, root));
  }

  return createGraph(FLEET_META, nodes, []);
}

// ---------------------------------------------------------------------------
// Merge — engine catalog + fleet catalog (the default knowledge catalog)
// ---------------------------------------------------------------------------

/**
 * Merge a base catalog (engine capabilities) with an extra catalog (fleet
 * agents). The base wins on metadata; extra nodes/edges append when they do
 * not collide (collisions are skipped, never duplicated). A zero-node extra
 * returns the base unchanged (identity — keeps today's engine-only default
 * byte-identical).
 */
export function mergeCatalogs(
  base: CapabilityGraph,
  extra: CapabilityGraph,
): CapabilityGraph {
  if (extra.nodes.length === 0) return base;
  const ids = new Set(base.nodes.map((n) => n.identity));
  const nodes = [...base.nodes];
  const edges = [...base.edges];
  const edgeKeys = new Set(edges.map((e) => `${e.type}|${e.from}|${e.to}`));
  for (const n of extra.nodes) {
    if (ids.has(n.identity)) {
      // fleet never shadows engine nodes
      continue;
    }
    ids.add(n.identity);
    nodes.push(n);
  }
  for (const e of extra.edges) {
    const key = `${e.type}|${e.from}|${e.to}`;
    if (!ids.has(e.from) || !ids.has(e.to) || edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push(e);
  }
  return createGraph(
    {
      name: base.metadata.name,
      version: base.metadata.version,
      engine: base.metadata.engine,
      source: `${base.metadata.source}; merged with ${extra.metadata.source}`,
    },
    nodes,
    edges,
  );
}

/**
 * The default knowledge catalog: the pure Pi engine capability catalog PLUS
 * the fleet agent catalog (when a fleet root resolves — production convention
 * or COMPANY_AGENTS_DIR or an explicit agentsRoot). Engine capabilities stay
 * exactly as before; fleet nodes carry agentRef so the facade's
 * knowledge.agentFor('agent.<name>') resolves to a real AgentRef.
 */
export function buildDefaultKnowledgeCatalog(
  opts: { readonly agentsRoot?: string } = {},
): CapabilityGraph {
  return mergeCatalogs(DEFAULT_CATALOG, buildFleetCatalog(opts));
}
