# EVIDENCE-DOMAIN-M — capability knowledge-model first pour (issue #2)

**Slice**: DOMAIN-M (Domain M — Mediation knowledge layer)
**Issue**: https://github.com/rethink-paradigms/mediation/issues/2
**Date**: 2026-08-07
**Commit**: see git log (message: `DOMAIN-M: capability knowledge-model first pour (issue #2)`)

---

## 1. What was built

A **first pour** of the mediation-layer capability knowledge-model — not the
whole vision, but real and usable:

| Piece | Location | What it is |
|---|---|---|
| Pure domain types | `src/domain/knowledge/types.ts` | `CapabilityNode` { identity, label, description, domain (enum\|range\|free), default+rationale, effect (summary+per-value), intentSignature[], incidentEdges (derived) }, typed edges (depends-on \| affects \| conflicts-with \| composes-with \| generalizes), `CapabilityGraph`, intent match types, config/violation/compose/explain result types |
| Graph helpers | `src/domain/knowledge/graph.ts` | `createGraph` (integrity-checked construction), find/require/incident-edges/children/generalizes navigation |
| Six operations | `src/domain/knowledge/operations.ts` | **Pure functions**: `listCapabilities`, `describeCapability`, `resolveIntent`, `validateConfig`, `composeCapabilities`, `explainConfig` — no engine imports |
| Port | `src/ports/knowledge.ts` | `KnowledgePort` { loadGraph, list, describe, resolve, validate, compose, explain } |
| Catalog adapter | `src/adapters/knowledge/catalog.ts` | Real initial catalog from Pi/Prime/Mock capability surfaces (25 nodes / 36 edges on pi) + `buildPiCatalog` / `buildPrimeCatalog` / `buildMockCatalog` / `buildCatalog(engine)` |
| Service adapter | `src/adapters/knowledge/service.ts` | `KnowledgeService` / `createKnowledgeService` — KnowledgePort over the operations |
| Public exports | `src/index.ts` | Appended (file was not rewritten) |
| Scenario suite | `test/knowledge/scenarios.test.ts` | 45 intent-first scenarios (written BEFORE the implementation — see §7) |
| Fidelity + integrity | `test/knowledge/fidelity.test.ts` | Catalog must match REAL Pi/Prime options (21 tests) |
| Port smoke | `test/knowledge/port.test.ts` | KnowledgePort surface (3 tests) |

## 2. Design citation

- **Spec**: `research/agent-configuration-knowledge-model/understanding/mediation-layer-concept.md` — nodes §4.1, edges §4.2, operations §4.3.
- **Node material**: `understanding/pi-sdk-feature-map.md` (Pi SDK v0.80.9 → M nodes) — used as the catalog source of truth.
- **D5**: `decisions/D5-capability-medium-independence.md` — identities are ids, never paths. Verified by a dedicated medium-independence test (no absolute paths, no `/`, no `..` in any identity; pattern `m.<segment>(.<segment>)*`).

## 3. Catalog inventory (pi catalog)

- **Nodes: 25**, **Edges: 36** (8 generalizes, 12 depends-on, 7 affects, 5 composes-with, 4 conflicts-with).
- Node families:
  - model: `m.model`
  - thinking: `m.thinking`, `m.thinking.budget`
  - tools: `m.tools` (category), `m.tools.read|bash|edit|write|ls|find|grep|custom` (leaves), `m.tools.denylist`, `m.tools.notools`, `m.tools.execution`, `m.tools.agent-mode`
  - resources: `m.extensions`, `m.skills`, `m.prompt`, `m.context-files`
  - session/runtime: `m.compaction`, `m.session.cwd`, `m.retry`, `m.transport`, `m.cache`
- Sample nodes with real intent signatures:
  - `m.thinking` — enum of the 7 real levels; "make it more careful" → suggests `high`; "keep it quick" → suggests `low`
  - `m.tools.read` — "let it read files", "look at the source"
  - `m.extensions` — "install a pack", "add an extension"
- Sample edges:
  - conflicts-with: `m.tools` ↔ `m.tools.denylist` (real Pi allowlist-vs-denylist), `m.tools` ↔ `m.tools.notools` (hard), `m.tools.denylist` ↔ `m.tools.notools`, `m.tools.notools=all` → `m.extensions` (value-conditioned)
  - depends-on: leaf tools → `m.tools`; `m.context-files` → `m.session.cwd`; `m.extensions` → `m.session.cwd`
  - composes-with: `m.thinking` ↔ `m.model` (level clamping), `m.tools.read` ↔ `m.tools.grep` (search-then-investigate), `m.tools.bash` ↔ `m.tools.edit` (edit-verify)
  - generalizes: `m.tools` → 7 builtin leaves + custom
- Engine scoping: `m.tools.denylist`, `m.tools.execution`, `m.transport`, `m.cache` are pi-scoped (the prime fork cannot express standalone exclude — no `excludeTools`; the mediation adapter does not wire Pi settings-level knobs). Prime/mock catalogs are thin variant markers (graph metadata `engine`), sharing the verified thinking/tools surface.

## 4. Operations semantics

| Operation | Signature | Semantics |
|---|---|---|
| list | `listCapabilities(graph, filter?)` | filter by category (generalizes children), free-text query, domain kind, engine scope → `NodeSummary[]` |
| describe | `describeCapability(graph, identity)` | full node + derived incident edges (both directions, typed, with notes) |
| resolve | `resolveIntent(graph, intent, opts?)` | fuzzy scoring: exact (1.0) > substring (0.85) > token Jaccard/coverage/bigram-Dice; weighted signatures; optional `suggests` value; ranked desc, limit/threshold; deterministic |
| validate | `validateConfig(graph, config)` | violations: UNKNOWN_NODE, OUT_OF_DOMAIN (enum/range/free+format), CONFLICT (hard; value-conditioned edges respected), UNMET_DEPENDENCY, INCONSISTENT (leaf enabled but category omits it) |
| compose | `composeCapabilities(graph, ids)` | emergences (composes-with pairs both present), side effects (affects edges to absent nodes), requires (depends-on to absent nodes), prose summary |
| explain | `explainConfig(graph, config)` | per-node why-choices: label, value, per-value effect, tradeoffs (vs default, conflicts, unmet deps), related edges, prose summary |

## 5. Fidelity verification (real, spot-checked)

Verified against the installed engines, not the feature map alone:

- `m.thinking` domain == Pi `ThinkingLevel` exactly: `off|minimal|low|medium|high|xhigh|max` (`@earendil-works/pi-agent-core/dist/types.d.ts:250`).
- `m.tools` domain == Pi `ToolName` exactly (order matches declaration): `read|bash|edit|write|grep|find|ls` (`pi-coding-agent/dist/core/tools/index.d.ts`).
- `m.thinking` **default `"off"`** — the mediation adapter's *effective* default (`req.settings.thinking ?? req.definition.thinking ?? "off"` in `src/adapters/pi/create-session.ts` and `src/adapters/prime/create-session.ts`). Fidelity note: Pi core's own `DEFAULT_THINKING_LEVEL` is `"medium"`; the adapter deliberately overrides it for mediation-owned sessions (D2). Both facts are stated in the node's default rationale.
- `m.tools` **default `[]`** — the adapter sets `noTools:"all"` when no builtin allowlist is declared; mediation sessions start with zero tools.
- `m.tools.denylist` is **pi-scoped**: the prime fork has no `excludeTools` (`primeToolsFromPolicy` in `src/adapters/prime/create-session.ts` maps exclude to allowlist subtraction and drops standalone excludes with a WARN).
- Model knowledge: `m.model` cites the real `Model` surface (`provider`, `reasoning`, `thinkingLevelMap` where null = unsupported level, `contextWindow`, `maxTokens`, `cost`; ModelRegistry/ModelRuntime resolution, 36 built-in providers + `models.json`).

### Honest fidelity decision: thinking:off vs "reasoning-heavy task"

The parent prompt suggested a conflicts-with pair "e.g. thinking:off vs reasoning-heavy task?" (question mark included). The mediation spec defines conflicts-with as a **hard validity constraint**. `thinking:off` is a legitimate engine value (Pi accepts it; it is the mediation adapter's default). A "reasoning-heavy task" is an **intent**, not an engine capability — adding a fake node for it would violate fidelity (M represents E's capability surface, spec §3). Instead:

- `resolve("make it more careful")` / `resolve("reason deeper")` rank `m.thinking` first with `suggests: high` (never `off`);
- `resolve("keep it quick")` ranks `m.thinking` with `suggests: low`;
- validate rejects genuinely contradictory *engine-level* tool policies (allowlist+denylist, notools+allowlist, notools+denylist) — the real conflict pairs Pi documents.

## 6. Test matrix

| Suite | File | Tests | Result |
|---|---|---|---|
| resolve scenarios (intent → ranked matches) | scenarios | 15 | pass |
| validate scenarios (domain/conflict/dependency) | scenarios | 14 | pass |
| compose scenarios (emergent + side effects) | scenarios | 5 | pass |
| explain scenarios (why-choices text) | scenarios | 3 | pass |
| list/describe scenarios (traversal) | scenarios | 6 | pass |
| medium independence (D5 — no paths in identities) | scenarios | 2 | pass |
| fidelity (real Pi/Prime options) | fidelity | 7 | pass |
| graph integrity (ids/edges/scoping) | fidelity | 7 | pass |
| port smoke (KnowledgePort) | port | 3 | pass |
| **knowledge total** | | **62** | **62 pass / 0 fail** |

Full gate: `npm run check` — tsgo clean, oxlint 0 errors, `tests 385 / pass 383 / fail 0 / skipped 2` (310 baseline + 62 knowledge + park-wake-fixer's concurrent slice tests), gauges OK (`layer_import_violations=0`, `second_door_count=0`, `export_integrity=0`, pack_plan parity 0).

## 7. Honest pass/fail progression (TESTING-DOCTRINE compliance)

1. **Scenario suite written FIRST** (`test/knowledge/scenarios.test.ts`) against a missing module → **red** (1 failing file, 0 pass).
2. Implementation poured → first full run: 3 failing files (catalog construction error `m.context-files` identity pattern), then 2 failing tests (tool enum **order** — catalog had `ls,find,grep`, Pi declares `grep,find,ls`). These were real fidelity defects in the catalog, fixed by matching the engine's declaration order — **no scenario was weakened or deleted**.
3. Second-door gauge caught `createAgentSession` mentioned in a catalog string literal (comments are stripped by the gauge, strings are not) → reworded, `second_door_count=0`.
4. Lint: 5 errors fixed (unicode regex flags, shadowed `id`, function scoping, lonely-if, map-spread). Final: **0 warnings, 0 errors**.
5. Final knowledge run: **62/62 pass**; full gate green.

## 8. Not touched (ownership boundaries)

- `src/app/**`, `src/surfaces/**` — untouched.
- `src/adapters/{pi,prime,mock,openworkflow,capability,compose,wiring,engine-registry}/**` — untouched (the catalog only *describes* their surfaces; it imports no adapter code).
- `src/domain/{engine,presence,capability,config-layer,definition}.ts` — untouched (read-only references: `EngineKind` type import in knowledge types/catalog).
- `src/ports/{engine,runtime,surface,capability-*}.ts` — untouched (new `ports/knowledge.ts` added alongside).
- `package.json` / `package-lock.json` — no new dependencies, no installs.
- Concurrent sibling work in the same tree (park-wake bridge files, `_dbg2.ts`, etc.) was **not** committed by this slice; this commit contains only DOMAIN-M files + the index.ts append + this evidence doc.

## 9. Open risks / next pour suggestions

- **Intent resolution is heuristic** (token/bigram scoring). Fine for a first pour; an LLM-routed or learned signature layer is a future refinement.
- **Model node is free-form** — a per-model knowledge subgraph (thinkingLevelMap, contextWindow, cost per provider/model) would sharpen validate (e.g. reject `xhigh` on a model that doesn't support it) and compose.
- **Value-conditioned edges** support only equality conditions today; range conditions (`thinking ≥ high`) are a natural extension.
- **Wiring**: nothing consumes KnowledgePort yet — next pour should surface it through `src/surfaces`/CLI (a `mediation knowledge resolve "..."` command) and/or the agent definition layer (validate agent.yaml against the catalog).
- **Live fidelity**: unit fidelity pins are checked against installed types; a `MEDIATION_LIVE_PI=1`-gated scenario could assert the catalog matches a live ModelRegistry listing.
