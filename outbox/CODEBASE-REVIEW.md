# CODEBASE-REVIEW — @company/mediation simplification & architecture audit

**Auditor:** CODEBASE-REVIEWER (read-only)
**Date:** 2026-08-07 (session)
**Audit target:** `product/mediation-engine/mediation` main worktree, tip `a0b3eca` (clean). Sibling worktree `/tmp/wt-polish` intentionally ignored.
**Method:** full read of `src/` (~70 files), `scripts/gauges/*`, `package.json`/`tsconfig`/`oxlint.json`, skim of `test/` (all 56 suites), `EVIDENCE-*.md`, `outbox/STATE-CODE-MAP.md`, `outbox/engine-selection-design.md`, design law (D0–D5 + `software-architecture.md` + `mediation-layer-concept.md`). `npm run check` executed (read-only): **PASS** — tsgo typecheck ✓, oxlint 0/0, **432 tests / 101 suites / 430 pass / 2 skip / 0 fail**, gauges OK (layer_import_violations=0, second_door_count=0, export_integrity=0, spawn_public_export_count=0, pack_parity_delta=0). Public export surface: **279** names.
**Deliverable:** this file only. No code, no installs, no commits.

---

## EXECUTIVE VERDICT

The codebase is **healthy and unusually well-governed**: the layer law (D4), the second-door gate, the spawn-death gate, and the evidence culture are real and enforced, the test suite is intent-first and scenario-driven (LIFE R1–R15, H1–H7, family F1–F12, DOMAIN-M 45 scenarios), and `npm run check` is a genuine compiler surface. The **single highest-leverage change is to connect or quarantine the DOMAIN-M knowledge subsystem** (`src/domain/knowledge/*`, `src/ports/knowledge.ts`, `src/adapters/knowledge/*` — ~1,955 lines, the largest unintegrated block in the package) which currently has **zero product consumers**: it is exported from `index.ts`, proven only by its own tests, and absent from the D4 port list. Second-order finding: heavy **pi/prime mirror duplication** (~150 lines in `create-session.ts` alone, 0.69–0.86 similarity across five file pairs) is documented as deliberate but is extractable without touching the second-door gauge. Everything else is small, low-risk cleanup.

---

## A. DEAD / VESTIGIAL CODE

| # | Location | Finding (why) |
|---|----------|---------------|
| A1 | `src/domain/engagement.ts:27-33` + `src/index.ts:73` | **`JoinKeys` is a dead type** — defined, exported, never referenced anywhere; `EngagementRecord` inlines the same four fields (runId ⨝ sessionRef ⨝ definitionId ⨝ packSnapshot). Either make `EngagementRecord` compose `JoinKeys` or delete the type. |
| A2 | `src/adapters/openworkflow/spawn-leaf.ts:110-116` | **Unreachable branch**: `else if (config.usePi === true)` can never fire — `resolveSpawnDefaultEngine` (line 63) maps `usePi:true → "pi"` first, so `defaultEngine` is always defined when `usePi` is true. The `--use-pi` legacy flag survives only in the runner (which legitimately parses it); the spawn-leaf push is dead. |
| A3 | `src/domain/knowledge/graph.ts:53,57` | **Corrupt error message**: `node "${id}" has no intent signatures` interpolates the module-level `id()` *function* instead of the loop variable `identity` (confirmed by execution: message prints the function source). Same defect at line 57 (`empty enum domain`). Message-only bug, but it is the exact diagnostic a catalog author gets on a bad node. |
| A4 | `src/adapters/legacy/spawn-engage.ts` (38 lines) | **Law-mandated placeholder**, not accidental: fail-closed stub kept per D3 L3; `MIGRATION-SPAWN.md` rows 4–6 (external docs, notify path, stub deletion) still OPEN. Keep — expiry is tracked, deletion would be premature. |
| A5 | `src/ports/engine.ts:97-100` (`EngineRegistry.has`/`kinds`) | **Dead port surface**: `has()` and `kinds` are called nowhere in `src/` — only by `test/engine-selection/engine-registry.test.ts`. `get()` is the only method product code uses. |
| A6 | `src/app/recipes/types.ts:17` (`Recipe.name`) | **Vestigial interface field**: all 7 recipes are single-method wrappers; nothing anywhere reads `recipe.name` (no recipe registry exists). The `Recipe<I,O>` interface itself adds an object indirection nothing consumes. |
| A7 | File-private exports (~19 symbols) | Exported but **never imported** anywhere (verified by full-tree scan): `compose.ts` `resolveCompositionDefaultEngine`, `resolveCapabilityResolverWithStores`; `yaml-definition-loader.ts` `mergeDefinitionLayers`, `LoadDefinitionOptions`; `wiring.ts` `createPrimePresenceFactory`, `PiPresenceComposition`, `PrimePresenceComposition`, `CreatePrimePresenceFactoryOptions`; `factory.ts` `capabilityLayersFromDefinition`; `packs/pack-snapshot.ts` `canonicalPackEntries`, `PackHashEntry`; `mock/engine-adapter.ts` `MockEngineAdapterOptions`; `pi/session-handle.ts` & `prime/session-handle.ts` option types; `openworkflow/host.ts` `SqliteRuntimeClient`; `domain/park-bridge.ts` `ParkBridgeInput`, `ParkBridgeMessage`; `domain/knowledge/graph.ts` `GraphBuildError`. Dropping `export` costs nothing. |
| A8 | `src/domain/knowledge/*` + `src/ports/knowledge.ts` + `src/adapters/knowledge/*` (~1,955 lines: catalog 843, operations 504, types 321, graph 167, service 75, port 45) | **Unconnected subsystem**: zero consumers in app/adapters/surfaces; only self-tests + index re-exports. Not in the D4 port list (D4 names EnginePort/RuntimePort/JoinStore/DefinitionLoader/Clock/IdGen only). Justified by `mediation-layer-concept.md` + issue #2, but as shipped it is build-ahead-of-need — the single biggest line count in `src/` with no runtime path. |
| A9 | `src/app/settled-policy.ts:36` (`maySettle`) | Convenience wrapper used by exactly one test (`test/presence/engage-settled.test.ts:43`); `evaluateSettled` is the real API. |

---

## B. DUPLICATION

| # | Location | Finding (why) |
|---|----------|---------------|
| B1 | `src/adapters/pi/create-session.ts` vs `src/adapters/prime/create-session.ts` | **~150 lines duplicated** (similarity 0.69): `parseModel`, `resolveSystemPrompt`, `extensionPathsFromPackPlan`, the whole `sessionManager` open/resume block (~40 lines), and the post-create tail (agentMode/bindExtensions/sessionRef). The file header itself documents it: *"Twin of adapters/pi's extensionPathsFromPackPlan (kept parallel so the Pi door surface is untouched)"*. The shared helpers contain **no `createAgentSession` call**, so extracting them to `src/adapters/shared/create-session-common.ts` does not trip the second-door gauge. |
| B2 | `src/adapters/pi/event-map.ts` vs `src/adapters/prime/event-map.ts` | 0.74 similarity; `textFromContent` duplicated verbatim; `message_end`/`tool_execution_*`/`agent_start` branches are character-identical except the message-narrowing helper. |
| B3 | `test/pi/fake-session.ts` vs `test/prime/fake-session.ts` | **0.86 similarity** (130 vs 132 lines) — same class structure, same counters, same settle machinery; only the event type and `agent_settled`-vs-`agent_end` idle delta differ. A single parametrized fake would serve both adapter suites. |
| B4 | `src/adapters/wiring.ts:69` (`resolveCapabilityResolver`) vs `src/adapters/compose.ts:153` (`resolveCapabilityResolverWithStores`) | **Two overlapping resolver policies**: wiring's is fs-only when a projectRoot is known; compose's default chain is `[registry, fs]`. Both are live (compose re-exports wiring's for "a single default policy" yet implements a superset) — the two can silently disagree on what an agent's extensions resolve to. |
| B5 | `src/adapters/openworkflow/register-plan.ts` vs `src/adapters/openworkflow/workflows/plan.ts` | The wave-execution loop (`computePlanWaves` + per-node `step.run` + `Promise.all`) is implemented **twice**: once in pure `runPlanWorkflow` (workflows/plan.ts:141-185) and again inline in `registerPlanWorkflow`'s implementWorkflow callback (register-plan.ts:110-136). `registerPlanWorkflow` could call `runPlanWorkflow` with an `executeLeaf` step wrapper. |
| B6 | `src/surfaces/cli.ts:234-292` (`composeRuntimeSurface`) | **Hand-rolled partial SurfacePort** re-mapping `dispatch/getStatus/wait/cancel/sendSignal/wake` onto `client.runtime` — the same DTO→call translation `src/adapters/surface/mediation-surface.ts` already defines. One shared runtime-client-backed SurfacePort would remove the second mapping site. |
| B7 | `src/adapters/mock/engine-adapter.ts` vs `src/adapters/shared/engine-session-handle.ts` | `MockEngineSessionHandle` re-implements the full `waitUntilIdle`/idleWaiter/busy/abort machinery (~70 lines) that `EngineSessionHandleBase` already provides. The base was extracted for pi/prime; the mock predates it and was never migrated. |
| B8 | `src/app/mediation.ts` (`notifyPayloadFor` + `safeNotify`) vs `src/adapters/openworkflow/workflows/engagement.ts` (`safeNotify`) | Same best-effort-notify and outcome→payload mapping pattern in both layers (see D1 for the outcome-mapping shape of this). |

---

## C. OVER-ABSTRACTION (accidental, not law-mandated)

| # | Location | Finding (why) |
|---|----------|---------------|
| C1 | `src/ports/engine.ts:95-100` (`EngineRegistry`) | `has()`/`kinds` — see A5. Law (D4 A2) mandates the port; it does not mandate two unused methods. `get()` is the law's whole surface. |
| C2 | `src/ports/knowledge.ts` + `src/adapters/knowledge/service.ts` | Port + service adapter + three catalogs for a subsystem with no consumer (A8). The port/service indirection has zero payoff until a surface consumes it. |
| C3 | `src/app/recipes/types.ts` (`Recipe<I,O>`) | See A6. D0 P6 mandates "recipes are functions over the core" — the 7 recipe objects satisfy that; the generic `Recipe` interface + `name` field is extra ceremony nothing uses. |
| C4 | `src/ports/surface.ts` | 8 of 9 methods are optional; every caller must feature-detect (`cli.ts` does `typeof surface.dispatch !== "function"` in 5 places). Optionality pushes type-safety onto surfaces; a discriminated union or a required core + optional control split would be tighter. (Low priority — the optionality is deliberate for local-vs-runtime surfaces.) |
| C5 | `src/app/factory.ts:82-108` (`capabilitySpecFromDefinition` + `capabilityLayersFromDefinition`) | Two helpers where the second exists only to wrap the first in a `[{kind:"agent"}]` list so the port contract stays uniform. `resolvePackPlan` could take the spec directly. |

**Law-mandated layers that look like over-abstraction but are NOT** (do not touch): the EnginePort/RuntimePort/JoinStore port triad, the adapter family split (pi/prime/mock/shared), `Mediation` façade, composition roots. D4 A1/A2/A3 freeze these; the cost is real but the law is the point.

---

## D. UNDER-ABSTRACTION / COMPLEXITY HOTSPOTS

**OutcomeMapper is still inline — it does not exist as a module yet.** RunOutcome construction/normalization is repeated in ≥4 places with slightly different shapes:
1. `src/app/presence.ts:76-145` — `engage()` builds settled/parked/failed from the settled-policy decision.
2. `src/adapters/openworkflow/workflows/engagement.ts:150-260` — the leaf re-branches on the same three outcomes for join update + output variant + notify payload.
3. `src/app/mediation.ts:155-170` — `reenter()` hand-builds a `failed` outcome for packSnapshot mismatch.
4. `src/app/mediation.ts:517-527` — `notifyPayloadFor()` maps outcome→notify payload a third shape.

The sibling OutcomeMapper work should be folded in; if it lands, all four sites should call it.

**Top 5 hotspots by estimated complexity:**

| Rank | File (lines) | Why it is hard |
|------|--------------|----------------|
| 1 | `src/adapters/compose.ts` (461) | Most entangled wiring in the package: 5-way capability-resolver policy (explicit resolver / store / chain / [registry,fs] / empty-memory), legacy `pi:` options → registry factory, `mockEngine`↔`defaultEngine` mapping, hosted join policy, spawn-config default threading. Three overlapping option types (`CreateLocalMediationOptions` / `CreateHostedMediationOptions` / `wireMind`). |
| 2 | `src/adapters/definition/yaml-definition-loader.ts` (725) | One file owns zod schema, residual-meta extraction, `mergeDefinitionLayers`, layer-file resolution (name-or-path), extends-chain cycle detection, and prompt loading (per-layer relative paths). 53 branch points; the merge rules (union vs later-wins vs replace) are only discoverable by reading `LAYER_MERGE_SKIP` + `mergeCapabilitySpecs` together. |
| 3 | `src/surfaces/cli.ts` (532) | 79 branches: hand-rolled arg parser, 7 subcommands, `--engine` > env > legacy `MEDIATION_CLI_PI` > mock-default precedence, two different surface compositions (local vs runtime-client) in one file. |
| 4 | `src/app/mediation.ts` (527) | Façade with 15 methods + 3 concerns: product ops, notify bridging (`observe`/`safeNotify`/`mediationEventFromNotify`), and the in-process live-presence registry (interrupt). Reenter pins engine + park reason + pack gate in one method. |
| 5 | `src/domain/knowledge/operations.ts` (504) | Six operations with hand-rolled fuzzy scoring (jaccard + coverage + bigram-dice + label bonus with magic weights 0.7/0.3/0.1), plus four validate passes over the same edge list. |

Honorable mention: `src/adapters/knowledge/catalog.ts` (843, biggest file) — but it is declarative node/edge data with a small build helper, low cognitive load; do not refactor it, consider a compact DSL later if the catalog grows.

---

## E. LAW DRIFT (gauges pass; letter/spirit bends)

| # | Law | Drift | Severity |
|---|-----|-------|----------|
| E1 | D4 A1/L5 (README: "Surfaces: public `@company/mediation` only") | **Surfaces import adapters directly**: `src/surfaces/cli.ts:24` imports `createRuntimeClient` from `../adapters/openworkflow/host.ts` — a symbol that is **not even in the public index** — plus `../adapters/compose.ts` and `../adapters/surface/mediation-surface.ts`; `daemon.ts` and `engagement-runner.ts` likewise import `../adapters/*` by relative path. The `layer-imports` gauge only scans domain/ports/app, so this passes. Intent (thin surface) is intact; letter is bent. Either surface imports should go through the public index (add `createRuntimeClient` there), or the gauge should scan surfaces too. | Medium (letter) / Low (intent) |
| E2 | D2 "Reenter packs: **snapshot** (original packSnapshot), not silent latest-yaml" | Implementation re-resolves current yaml on every reenter; snapshot equality is **opt-in** (`ReenterInput.expectedPackSnapshotHash`, `reenterFromJoin` `enforcePackSnapshot`). Default behavior = silent latest-yaml, the exact thing D2 forbids. | Medium — behavior, not just letter; changing the default could break flows that intentionally reenter on updated yaml, so flag-not-redesign. |
| E3 | D5 L4 ("Existing `PackRef.path` migrates toward optional/locator; id is canonical") | Migration incomplete: `domain/packs.ts:15` still requires `path: string`; `factory.ts` `packLoadPlanFromCapabilityArtifacts` fails closed when a capability has no module path. Path is still required at the domain boundary to materialize. Documented, partial. | Low |
| E4 | D0/D4 A3 (one door) — second-door gauge completeness | The door regex `createAgentSession(?:FromServices)?` would **not** match `createAgentSessionServices` (the third Pi surface named in `software-architecture.md` §2.2). Currently 0 uses in `src/` (verified), so no live violation — but the gate has a hole that a future adapter could slip through. | Low (latent) |
| E5 | S2e design §2 (`EngineRegistry.has`) | `has()` returns "is a known kind", not "is available" — `has("prime")` is true even when the prime adapter module cannot load, and the test pins that semantics. If a future caller uses `has()` for feasibility, it lies. | Low |
| E6 | D2 spirit ("mock explicit-only; mock-green ≠ live-green") | `src/surfaces/daemon.ts:60` — the **production daemon entry point defaults to the mock engine** (`mockEngine: !USE_PI`, i.e. mock unless `MEDIATION_USE_PI=1`). Explicit in code, but a production binary whose default is a fake engine is the same class of footgun the park-wake bug documented (mock-green ≠ live-green). | Low-Medium |
| E7 | D1 status machine / D4 A4 | No drift found: presence status ≠ run status ≠ join status are kept separate and correlated only via the join record; domain purity holds (no vendor imports — gauge proves it). **This is fine.** | — |

---

## F. TEST QUALITY SIGNALS

| # | Signal | Location | Finding |
|---|--------|----------|---------|
| F1 | **Test that could never fail** | `scripts/gauges/pack-plan.ts:59-60` | `planA` and `planB` are computed from the **identical call** (`packLoadPlanFromFsSpecs(extensionSpecs, root, homeDir)` twice). `pack_parity_delta` is therefore always 0 — the S1 "parity" gate is a tautology and can never fire. The *real* parity (headless vs reenter materialize, same yaml → same hash) is tested elsewhere (`resume-fidelity.test.ts`, `reenter` tests) — the gauge should call the two *different* paths it claims to compare, or be deleted. |
| F2 | **Missing negative tests** | `test/knowledge/` — zero tests exercise `createGraph` validation failures (duplicate id, duplicate edge, self-edge, unknown endpoint, empty intentSignature, empty enum). Those paths are exactly where the A3 `${id}` message bug lives; a throw-assert would not have caught it, a message-assert would. |
| F3 | **Test pins vacuous semantics** | `test/engine-selection/engine-registry.test.ts:24-26` | `has("prime") === true` asserts "known kind", cementing E5 instead of testing availability. |
| F4 | **Mock-green masking (documented, managed)** | `TESTING-DOCTRINE.md` + `INVESTIGATION-park-wake-continue-design-gap.md` | The mock engine has no role guard, so the park→wake continue bug stayed green on mock. The doctrine's answer (gated live suites) is correct and the H4b live test now covers the bridge. Residual risk: live suites **skip in the default gate** (2 skips) — mock-green remains the only default-gate proof for engine-touching paths. This is a known, accepted trade-off; flagging only that it is still true. |
| F5 | **Mirror duplication in tests** | `test/pi/*` vs `test/prime/*` | 0.43–0.86 similarity across fake-session, engine-adapter, event-map, create-session-paths suites (see B3). A shared parametrized fake + shared adapter-suite template would halve this. |
| F6 | Positives (no change) | — | Scenario-first suites with real negative coverage (fail-closed packs, missing layers, cycles, unknown engines, PRESENCE_NOT_LIVE), regression suites (`park-wake-regression` 482 lines), and the harness scenarios (`scenario_harness/`, 13 scenarios with assertion boundaries). The test culture here is the package's best asset. |

---

## G. IMPROVEMENTS RANKED

| # | Opportunity | Effort | Impact | Risk | Concrete first step |
|---|-------------|--------|--------|------|---------------------|
| 1 | Connect or quarantine DOMAIN-M knowledge subsystem (~1,955 lines, 0 consumers) | M (wire) / S (quarantine) | M | L | Either add 2 CLI subcommands (`describe`, `resolve`) over `KnowledgeService`, or move it behind a documented out-of-gate flag; either way stop shipping it as unconnected public API |
| 2 | Extract pi/prime shared session-open helpers (parseModel, resolveSystemPrompt, sessionManager block, post-create tail) to `adapters/shared/` | M | M | L (no `createAgentSession` in helpers → second-door gauge unaffected; run `npm run check`) | Move `parseModel`+`resolveSystemPrompt`+`extensionPathsFromPackPlan` to `shared/create-session-common.ts`, re-export from both adapters |
| 3 | Fix `graph.ts` `${id}` message bug + add createGraph negative tests | S | S | L | Change `${id}` → `${identity}` (lines 53, 57); add 5 throw-asserts for the validation paths |
| 4 | Delete dead `spawn-leaf.ts:112-116` `else if (usePi)` branch | S | S | L | Remove the branch + its comment |
| 5 | Use `JoinKeys` in `EngagementRecord` or delete the type | S | S | L | `type EngagementRecord = JoinKeys & {...}` and delete the four inline fields |
| 6 | Replace tautological pack-plan parity with a real two-path comparison | S | M | L | In `pack-plan.ts`, resolve `planA` via CapabilityResolver chain and `planB` via `packLoadPlanFromFsSpecs`; parity then means something |
| 7 | Drop `export` from ~19 file-private symbols (A7) | S | S | L | Remove `export` where the symbol is only used in its own file |
| 8 | Remove dead `EngineRegistry.has()`/`kinds` (or give `has` availability semantics) | S | S | L | Grep has zero product callers; delete both, keep `get()` |
| 9 | Unify capability-resolver policy (wiring vs compose) into one module | M | M | M (behavior: compose default chain is registry→fs; wiring is fs-only — must preserve both call sites' intent) | Make `resolveCapabilityResolverWithStores` the single implementation; `wiring.resolveCapabilityResolver` delegates |
| 10 | `registerPlanWorkflow` calls `runPlanWorkflow` via an `executeLeaf` step wrapper | S | S | L | Replace the inline wave loop with `runPlanWorkflow(plan, { ..., executeLeaf })` |
| 11 | Fold OutcomeMapper in (sibling in progress) — do not duplicate | M | M | M (behavior parity across 4 call sites) | After the sibling lands, route presence.engage, leaf, reenter, notifyPayloadFor through one module |
| 12 | Surface imports: go through public index or add `createRuntimeClient` + scan surfaces in layer-imports gauge | S | S-M | L | Export `createRuntimeClient` from index.ts (or import it there) and extend the gauge to surfaces |
| 13 | Reenter default: enforce D2 snapshot parity (snapshot, not latest-yaml) | M | M | M (may break flows that intentionally reenter on updated yaml — needs product sign-off) | Change `reenterFromJoin` default to `enforcePackSnapshot: true` and observe the gate |
| 14 | Prune index.ts public surface (279 → ~120) | M | M | M (private package, but external harness/surfaces may import the extras) | Remove adapter-internal exports (`mapPrimeEvent`, `PrimeSessionSurface`, `resolveFsModule`, `canonicalPackEntries`, …) and let export-integrity confirm |
| 15 | `daemon.ts`: fail closed without a real engine or at least warn loudly | S | S-M | L | If `MEDIATION_USE_PI` unset and no `MEDIATION_DEFAULT_ENGINE`, print a prominent warning that the daemon is running the mock engine |

---

## DO NOT TOUCH (sacred)

- **Monocoque factory** — `src/app/factory.ts` (`DefaultPresenceFactory`): sole `materialize` door, exactly-one-of `engine|registry` wiring, fail-closed resolve. Any rewrite here is a second-door risk; flag, don't redesign.
- **Gauges** — `scripts/gauges/{layer-imports, second-door, spawn-death, export-integrity, run}.ts`: hard architectural gates; the process must keep failing on `layer_import_violations !== 0`, `second_door_count !== 0`, `spawn_public_export_count !== 0`. (F1's pack-plan parity is an exception — it is observational and currently measures nothing; fixing it does not touch the fail-closed gates.)
- **Evidence culture** — `EVIDENCE-*.md`, `TESTING-DOCTRINE.md`, `MIGRATION-SPAWN.md` checklist, `scenario_harness/`: this is how the package proves intent; do not trim tests to raise pass percentages (doctrine rule 1–2).
- **Layer law** — D4 structure (domain pure / ports domain-only / app domain+ports / adapters one-vendor / surfaces thin). Do not "simplify" by merging layers or letting app import vendors; the gauge proves it and the audit found no violation.
- **pack-snapshot hash stability** — `src/adapters/packs/pack-snapshot.ts`: hash identity is `{id, source}` sorted, **never absolute paths**; this portability is a hard-won S1 lesson (host-fragile hashing was removed deliberately). Do not add paths back to the hash.

---

## APPENDIX — things NOT verified

- **Live-gated suites** (`MEDIATION_LIVE_PI=1` / `MEDIATION_LIVE_PRIME=1`) — skipped in the default gate; not run here (read-only session, no live keys). The H4b bridge fix is asserted by a live test that was **not** executed; its green status on real Pi is unverified in this audit.
- **Prime adapter against the real prime-agent SDK** — the gate runs unit/fake paths only; live prime behavior (auth, ModelRegistry, `followUp` boolean receipt) unverified.
- **`/tmp/wt-polish`** — intentionally not read, per instructions. Its existence (branch `slice/polish-issue5`, same tip `a0b3eca`) means some findings here (e.g. index surface, CLI) may overlap with in-flight polish work.
- **Daemon / runtime-client against a real OW daemon DB** — no runtime evidence that `src/surfaces/daemon.ts` has been operated; CLI runtime verbs against a live daemon untested here.
- **`npm install`** — not run; `node_modules` state taken as-is (prior audit noted install fragility at older tips; current tip installs cleanly per `check`).
- **Production behavior of `CapabilityResolver` registry→fs chain** — the default composite is exercised by tests with injected stores; the end-to-end "publish → get → materialize" path via `createHostedMediation` defaults was not live-run.
