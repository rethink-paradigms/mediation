# EVIDENCE — CATALOG ACCURACY (PHASE 2 SLICE)

Slice: `slice/phase2-catalog` — teach the Domain-M knowledge catalog the company fleet.
Base: `9a07e99` (main — Domain-M knowledge face + agentRef seam already present).
Worktree: `/tmp/wt-catalog`. Nothing committed; main tree untouched.

---

## 1. What was true before (the gap)

- `DEFAULT_CATALOG` (`src/adapters/knowledge/catalog.ts`) had 25 engine-capability nodes
  (`m.*`) and **zero agent nodes**. `resolveIntent("dispatch our web researcher")` returned
  capability matches only; `knowledge.agentFor(...)` was always `undefined` — the terminal
  agent could not resolve "dispatch our web researcher" to a real company agent.
- The seam already existed: `CapabilityNode.agentRef?: AgentRef` +
  `KnowledgeService(graph, agentRefs)` + facade `knowledge.agentFor`. This slice fills it
  with **data + mapping**, with no port changes.

## 2. Fleet coverage (57 agents — full fleet, generative)

`buildFleetCatalog({ agentsRoot })` scans `<agentsRoot>/*/agent.yaml` and produces one
`agent.<name>` node per agent directory. Verified against the REAL company fleet
(`/Users/samanvayayagsen/project/rethink-paradigms/company/agents` — 57 `agent.yaml`):

| metric | value |
|---|---|
| fleet nodes built (real tree) | **57** |
| D5 identity violations | 0 |
| nodes without agentRef | 0 |
| nodes with thin descriptions (< 20 chars) | 0 |

Coverage is **generative**: a directory with an `agent.yaml` that is NOT in the curated
manifest is still added (derived purely from disk) — the catalog tracks fleet additions
without hand-edits (proved by the `mystery-agent` fixture test).

## 3. Derivation approach — curated vs generated

**Curated (14 agents the human actually dispatches)** — `FLEET_MANIFEST` pins label,
description, and intent signatures:
`web-researcher, brain-explorer, coding-agent, intel-researcher, lego-researcher,
session-analyst, pi-agent-designer, storyline-agent, cognitive-cartographer, yt-researcher,
email, product-researcher, visual-cortex, notion`.

**Auto-derived (43 remaining)** — derived at build time from each agent's `agent.yaml`:
- description precedence: curated manifest > `agent.yaml.description` field (9 agents have
  one, e.g. `dyadic-weaver`, `process-pattern-extractor`) > prompt-file first prose lines
  (`prompt:` field → prompt.md; fallback spec.md / README.md) > name+model+tools template.
- intent signatures: name phrases ("process pattern extractor", "dispatch
  process-pattern-extractor") + custom-tool phrases ("web search", "sniff signal") — so
  even un-curated agents resolve by name and by their distinctive tools.

## 4. Id scheme (D5-clean)

- Node identities: **`agent.<name>`** (e.g. `agent.web-researcher`) — canonical ids, never
  paths. The identity pattern in `src/domain/knowledge/types.ts` was widened from
  `^m\.…$` to `^(m|agent)\.…$` — the one domain seam this slice needed (ids must pass
  `createGraph`'s integrity validation).
- Filesystem paths exist ONLY inside `AgentRef.rootDir` (a resolution VALUE, exactly like
  `m.session.cwd` accepts paths as parameter values — D5 bans paths as IDENTITY, not as
  values).
- D5 verified: new nodes match `CAPABILITY_IDENTITY_PATTERN`, contain no `/`, `\`, `..`.

## 5. agentFor mapping

- Every agent node carries `agentRef = { name, rootDir }` where `rootDir` =
  `<agentsRoot>/<agent-dir>` (definition-loader-resolvable: `loader.load(ref)` reads
  `<rootDir>/agent.yaml`).
- `KnowledgeService.agentFor` already honors node-declared `agentRef` first — so the bridge
  works with **zero service changes**.
- Default wiring (both composition roots): `createLocalMediation` / `createHostedMediation`
  now build default knowledge via `buildDefaultKnowledgeCatalog({ agentsRoot })` =
  `mergeCatalogs(DEFAULT_CATALOG, buildFleetCatalog(...))`. Engine capabilities intact;
  fleet nodes append. Explicit `knowledge` port still wins.

Fleet root resolution (in order): explicit `fleetAgentsRoot` option →
`COMPANY_AGENTS_DIR` env → company convention (`<company>/agents` resolved from this
package's location — mediation lives at `<company>/product/mediation-engine/mediation`, so the company root
is 5 levels up from `src/adapters/knowledge/`). No existing root → default stays
engine-only (byte-identical to today — `mergeCatalogs` returns the base unchanged for a
zero-node fleet).

## 6. Files

| file | change |
|---|---|
| `src/adapters/knowledge/fleet-catalog.ts` | **new** — manifest (14 curated + 43 auto), generative builder, fleet-root resolver, disk derivation, merge, `buildDefaultKnowledgeCatalog` |
| `src/domain/knowledge/types.ts` | identity pattern `^(m\|agent)\.…$` (+ doc) — the seam for `agent.` ids |
| `src/adapters/compose.ts` | default knowledge = engine catalog + fleet; `fleetAgentsRoot` option on both roots |
| `src/adapters/knowledge/service.ts` | doc only (bridge already honors node `agentRef`) |
| `src/index.ts` | public exports: `FLEET_MANIFEST`, `buildFleetCatalog`, `buildFleetNode`, `buildDefaultKnowledgeCatalog`, `mergeCatalogs`, `resolveFleetAgentsRoot`, `humanizeAgentName`, type `FleetAgentManifestEntry` |
| `fixtures/fleet-agents/` | **new** — 16-agent fixture (8 curated + 6 curated-not-in-fixture + description-field agent + generative mystery agent) |
| `test/knowledge/fleet-catalog.test.ts` | **new** — 22 tests |
| `test/knowledge/facade-knowledge.test.ts` | updated 1 pin (default-catalog "no agent mapping" now scoped to the plain service default; added compose-wiring test) |

Not touched: `app/mediation.ts`, `ports/*`, `surfaces/*`, `adapters/pi|prime`,
openworkflow host, `domain/park-bridge`, `cli.ts`. Engine catalog (`catalog.ts`) itself is
unchanged — the fleet layer lives in a separate adapter module that imports it.

## 7. Test matrix

`test/knowledge/fleet-catalog.test.ts` (22 tests, all pass):

| area | covers |
|---|---|
| generative builder | one node per agent.yaml dir; unknown agents added generatively (`mystery-agent`); `yaml.description` precedence; prompt-first-lines derivation; AgentRef shape on every node; graceful degradation (no root → empty fleet; merge identity) |
| D5 medium independence | new node ids match `(m|agent).<segment>.*`, no `/`, `\`, `..`, ids namespaced `agent.`; ids canonical via describe |
| curated resolution | `resolveIntent("dispatch our web researcher")` → `agent.web-researcher` (score 1.0); session-analyst / lego-researcher rank; `describe("agent.web-researcher")` label/description/domain/effect/agentRef; ≥5 curated agents with intents |
| agentFor bridge | `agentFor("agent.web-researcher")` → real AgentRef; full seam resolveIntent→agentFor→AgentRef round-trip; engine `m.*` ids still unmapped |
| default merge | merged catalog has engine + fleet nodes; pure engine resolve behavior unchanged (`make it more careful` → `m.thinking` @ high); no-root default byte-identical to `DEFAULT_CATALOG` |
| compose wiring | local + hosted roots resolve `agentFor("agent.web-researcher")`/`("agent.coding-agent")` via facade; explicit `knowledge` port still wins |
| manifest integrity | all 14 curated entries materialize with substantive descriptions |

Production smoke (not a committed test — run against the real fleet): 57 nodes, 0 D5
violations, `dispatch our web researcher` → `agent.web-researcher` @ 1.00, all curated
intents resolve @ 1.00, auto node (`process-pattern-extractor`) derives clean label /
description / intents.

## 8. Check summary (worktree, `npm run check`)

```
tsgo --noEmit                         0 errors
oxlint (230 rules, 177 files)         0 warnings / 0 errors
node --test (test/**/*.test.ts)       489 tests — 486 pass, 0 fail, 3 skipped (pre-existing live-*)
gauges                                layer_import_violations=0, second_door_count=0,
                                      export_integrity=0, spawn_public_export_count=0, pack_plan OK
```

## 9. Open risks / notes

1. **Fleet root availability**: the production convention (`<company>/agents` from module
   location) only resolves when the package runs from the company tree. From the slice
   worktree (or a detached checkout) the default degrades gracefully to engine-only —
   tests are deterministic because they inject `fleetAgentsRoot` (fixture) explicitly.
   If the package is ever deployed outside the company tree, set `COMPANY_AGENTS_DIR`.
2. **Staleness**: auto-derived descriptions come from prompt.md first lines at BUILD time,
   so they track prompt edits automatically; curated descriptions for the 14 dispatched
   agents are intentionally stable (hand-written) and only change via `FLEET_MANIFEST`.
3. **No agent edges yet**: fleet nodes currently have zero graph edges (they are leaf
   resources). A later slice could add `composes-with`/`depends-on` edges (e.g. agents that
   depend on engine capabilities like m.tools) — deliberately out of scope here.
4. **`agent.<name>` vs `m.agent.<name>`**: chose the `agent.` namespace per the slice brief;
   this required widening the identity pattern (the one domain change). The old `m.`-only
   pattern remains valid for all engine nodes; existing tests that hard-code the `m.` regex
   run against `buildPiCatalog()` only and stay green.
5. **`web-researcher-v2` label overlap**: "dispatch our web researcher" resolves to
   `agent.web-researcher` @ 1.00 with `agent.web-researcher-v2` second (@ 0.55) — expected;
   the curated exact phrase wins.
