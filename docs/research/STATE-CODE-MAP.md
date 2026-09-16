# STATE-CODE-MAP — @company/mediation (product/mediation-engine/mediation)

**Audit date:** 2026-08-07 (auditor: CODE-MAPPER, read-only)
**Package:** `@company/mediation` — sole Agent Presence monocoque (README.md)
**Method:** git + filesystem inspection + `npm run check` (run, not assumed). No files edited except this output.

---

## ONE-PAGE SUMMARY

| Axis | Value |
|---|---|
| **STATE** | **GREEN** — `npm run check` passes end-to-end on the CURRENT working tree (incl. all uncommitted work) |
| **Git tip** | `cf55f55` (2026-07-21 00:22:51 +0530, "Enhance scenario harness with explicit assertion boundaries.") — 98 commits on `main`, single worktree, 1 stash |
| **Uncommitted** | 36 modified tracked files + 19 untracked paths — the entire S2e **engine-selection** and **prime-adapter** slices plus spawn-leaf/daemon/engagement-runner land here, uncommitted |
| **Check** | typecheck (tsgo) PASS · lint 0/0 · tests **310 pass / 2 skip / 0 fail** (312 tests, 82 suites) · gauges all 0 (layer_import_violations=0, second_door_count=0, export_integrity=0, spawn_public_export_count=0, pack_parity_delta=0) |
| **Layer coverage** | 68 src `.ts` files: domain 9 · ports 7 · app 4+7 recipes · adapters 37 · surfaces 3 · index 1. All 7 designed ports present in code; **NotifyPort, Clock/IdGen absent (never designed into this package's port set — see §3)**; legacy PackResolver removed |
| **Gaps (documented)** | park→wake default `continue` broken on real Pi (`Cannot continue from message role: assistant`, commit `e0b0e8a`, `INVESTIGATION-park-wake-continue-design-gap.md`); H4b/H6b live degradations; live suites gated behind env vars; registry store is a stub; legacy spawn stub retained |

**Open risks (top 3):** (1) the whole S2e/prime/spawn wave is uncommitted — one bad `git` operation or a lost working tree loses it; (2) park→wake continue semantic is a live-Pi defect masked by the mock engine, so mock-green ≠ production-green for that path; (3) `package.json` deps were broken at HEAD (`cf55f55` could not install) and were only repaired in the uncommitted diff (`EVIDENCE-RESTORE-INSTALL.md`).

---

## 1. GIT REALITY

- **Full history:** 98 commits (`git log --oneline --all | wc -l` → 98). One branch: `main`. One worktree: the repo itself (`git worktree list` shows only the main path). One stash: `stash@{0}` = "On slice/S5a-ow-runtime-port: s5a-wip-preserve" (the two odd `index on slice/S5a-ow-runtime-port` / `untracked files on slice/S5a-ow-runtime-port` log entries are the stash's synthetic commits under `refs/stash`).
- **Tip:** `cf55f55` "Enhance scenario harness with explicit assertion boundaries." (2026-07-21 00:22:51 +0530).
- **Last ~12 commits (what they did):**

| SHA | What |
|---|---|
| `cf55f55` | Scenario harness: explicit assertion boundaries (final HEAD) |
| `e0b0e8a` | Docs: investigate park-wake continue design gap under real Pi (`INVESTIGATION-park-wake-continue-design-gap.md`) |
| `a2b6725` | LIFE-P3: record merge tip in evidence |
| `f664338` | Merge `slice/LIFE-P3-runtime-control` |
| `55bb1c6` | LIFE-P3: control façade + full runtime scenario suite |
| `1191fd1` | LIFE-P2: record merge tip SHA in evidence |
| `3f6b229` | Merge `slice/LIFE-P2-wake-continue` |
| `f7bcc30` | LIFE-P2: wake continues same run via leaf rematerialize |
| `b3587eb` | LIFE-P1: record merge tip SHA in evidence |
| `4e45c66` | Merge `slice/LIFE-P1-park-wait` |
| `69d24c1` | LIFE-P1: Model P park wait on engagement arc |
| `1367840` | Scaffold OW engagement SoC before LIFE park continuum |

  Older slices visible in history as merge commits: S0–S11, ABS-A1..A8, ABS-B1..B3, ABS-C1/C2, ABS-R1, ABS-WAVE, CUT-capability-cutover, PRODUCT-1. Branch names survive only in merge commits — the slice branches are deleted.

- **EXACT uncommitted state (`git status --short`):**
  - **Modified tracked (36):** `package.json`, `package-lock.json`, `scenario_harness/cli.ts`, `scenario_harness/runner.ts`, `scripts/gauges/layer-imports.ts`, `scripts/gauges/second-door.ts`, `src/adapters/compose.ts`, `src/adapters/definition/yaml-definition-loader.ts`, `src/adapters/join/sqlite-store.ts`, `src/adapters/openworkflow/{host,register-engagement,register-plan,runtime,types}.ts`, `src/adapters/openworkflow/workflows/{engagement,engagement-arc,plan}.ts`, `src/adapters/pi/session-handle.ts`, `src/adapters/surface/mediation-surface.ts`, `src/adapters/wiring.ts`, `src/app/{factory,mediation}.ts`, `src/domain/{config-layer,definition,engagement,errors,presence}.ts`, `src/index.ts`, `src/ports/{engine,runtime,surface}.ts`, `src/surfaces/cli.ts`, `test/{definition/yaml-definition-loader,domain/config-layer,product/durable-pilot,runtime/ow-plan}.test.ts` (+ `package-lock.json`). Diff stat: **36 files, +1357/−371**.
  - **Untracked new (19 paths):** `src/adapters/engine-registry.ts`, `src/adapters/openworkflow/spawn-leaf.ts`, `src/adapters/prime/` (6 files), `src/adapters/shared/` (engine-session-handle.ts), `src/domain/engine.ts`, `src/surfaces/daemon.ts`, `src/surfaces/engagement-runner.ts`, `test/engine-selection/` (9 files), `test/prime/` (5 files incl. live-prime), `test/runtime/{ow-worker-spawn,spawn-leaf}.test.ts`, `EVIDENCE-ENGINE-SELECTION.md`, `EVIDENCE-PRIME-ADAPTER.md`, `EVIDENCE-RESTORE-INSTALL.md`, `fixtures/packs/case-basic/agent.yaml`, `outbox/engine-selection-design.md`, `package-lock.json.npm-bak`, `scenario_harness/scenarios/{12-spawn-dispatch-workflow,13-spawn-engage-local}.yml`.
  - **Notable:** the S2e engine-selection + prime-adapter + spawn-isolation wave is 100% uncommitted. `.gitignore` ignores `node_modules/`, `*.sqlite` etc.; `outbox/` and `results/` are tracked (only the new outbox design doc is untracked).

## 2. LAYER INVENTORY vs D4

### src/domain (9 files — pure, no vendor imports; enforced by gauge)
| File | One-line role |
|---|---|
| `capability.ts` | Medium-independent capability identity (ABS-A1, D5): `CapabilityId`, `CapabilityPlan`, diagnostics |
| `config-layer.ts` | Root·family·agent capability spec merge (ABS-A5), incl. winning `engine` |
| `definition.ts` | Inert `AgentDefinition`/`AgentRef` DTOs (company agent.yaml contract), incl. declared `engine` |
| `engagement.ts` | Dual-durability join types (D0 P4): `RunId`, `JoinKeys`, `EngagementRecord` (has `engine`) |
| `engine.ts` | **NEW (untracked)** S2e runtime engine selection: `ENGINE_KINDS = ["pi","prime","mock"]`, `resolveEngineKind` precedence override > config > default > "pi", fail-closed `asEngineKind` |
| `errors.ts` | `MediationError` taxonomy (incl. new `ENGINE_UNKNOWN`) |
| `events.ts` | Domain-level `MediationEvent` (presence observe) |
| `packs.ts` | Pack resolution plan / snapshot types (bridge from CapabilityPlan) |
| `presence.ts` | Presence monocoque contract (D1): `AgentPresence`, `EngageInput`, `RunOutcome`, `MaterializeOptions` |

### src/ports (7 files)
| File | Port | Role |
|---|---|---|
| `engine.ts` | EnginePort + EngineSessionHandle + **EngineRegistry** (new) | Stable face over Pi/Prime/mock; domain never sees vendor types |
| `runtime.ts` | RuntimePort | Durable orchestration face (OpenWorkflow default); `DispatchInput` carries `engine` |
| `join.ts` | JoinStore | Dual-durability index runId ⨝ sessionRef ⨝ packSnapshot ⨝ definitionId |
| `capability-store.ts` | CapabilityStore + CapabilityPublisher | Resolve capability ids → artifacts (D5 L2) |
| `capability-resolver.ts` | CapabilityResolver | Merge config layers + store.get fail-closed (ABS-A6) |
| `surface.ts` | SurfacePort | Client connector DTOs (ABS-B1) — no app imports |
| `definition-loader.ts` | DefinitionLoader | Load inert AgentDefinition from AgentRef |

### src/app (4 files + recipes/)
| File | Role |
|---|---|
| `factory.ts` | `DefaultPresenceFactory` — sole Presence constructor; now engine-registry aware (engine|registry XOR wiring) |
| `mediation.ts` | `Mediation` façade — engageLocal/reenter/dispatch/wait/wake over ports |
| `presence.ts` | `DefaultAgentPresence` status machine over EngineSessionHandle |
| `settled-policy.ts` | Settled gate (idle + no park intent) |
| `recipes/` | **A–G recipes as thin wrappers (D0 P6):** `solo.ts` (A), `dispatch.ts` (B), `plan.ts` (C), `reenter.ts` (E), `wake.ts` (F/Model P), `types.ts`, `index.ts` barrel. **No `live` and no `observe` recipe files exist** (task's live/observe are not shipped; "observe" presence surface lives in `domain/presence.ts` `PresenceEvent`, "live" is the Pi/Prime engine kind, not a recipe). |

### src/adapters (37 files)
- **pi/** (6): `engine-adapter.ts` (PiEngineAdapter), `create-session.ts` (sole Pi `createAgentSession` door), `session-handle.ts` (now thin wrapper over shared base), `event-map.ts`, `types.ts`, `index.ts`.
- **prime/** (6, all untracked): mirror slice over the prime-agent fork — `engine-adapter.ts` (PrimeEngineAdapter), `create-session.ts` (sole prime door; fork deltas: ModelRegistry getAll loop, tools allowlist, no excludeTools), `session-handle.ts`, `event-map.ts`, `types.ts`, `index.ts`.
- **shared/** (1, untracked): `engine-session-handle.ts` — `EngineSessionHandleBase<TEvent>` shared waitUntilIdle/busy/event-fanout for both engines.
- **mock/** (1): `engine-adapter.ts` (MockEnginePort).
- **capability/** (4): `fs-store.ts` (FsCapabilityStore, D5 L4), `memory-store.ts`, `registry-store.ts` (in-process registry **stub**, no HTTP), `resolve.ts` (DefaultCapabilityResolver).
- **join/** (2): `memory-store.ts`, `sqlite-store.ts` (durable).
- **packs/** (1): `pack-snapshot.ts` (toPackSnapshot, packPlanHash). **No resolve-packs.ts / pack-resolver.ts — removed in `a0eb499` (CUT).**
- **definition/** (1): `yaml-definition-loader.ts` (agent.yaml → inert AgentDefinition; now maps `engine:`).
- **legacy/** (1): `spawn-engage.ts` — private fail-closed stub, not exported from index (S11/D3).
- **openworkflow/** (11): `runtime.ts` (RuntimePort over OW client), `types.ts` (serializable EngagementWorkflowInput/Output, engine field), `signals.ts` (wake signal names + zod payload), `host.ts` (createSqliteRuntimeHost), `register-engagement.ts`, `register-plan.ts`, `spawn-leaf.ts` (**untracked**, child-process leaf executor), `workflows/engagement.ts` (Gamma leaf), `workflows/engagement-arc.ts` (durable park/wake arc, `ENGAGEMENT_ARC_MAX_PARK_LOOPS=32`), `workflows/plan.ts` (plan leaf + DAG waves v2), `MODULE-MAP.md` (SoC ownership).
- **surface/** (1): `mediation-surface.ts` (Mediation as SurfacePort).
- **composition roots:** `compose.ts` (createLocalMediation / createHostedMediation + resolveHostedJoin), `wiring.ts` (createPiPresenceFactory / createPrimePresenceFactory / resolveCapabilityResolver), `engine-registry.ts` (**untracked**, createEngineRegistry).

### src/surfaces (3)
- `cli.ts` — thin CLI over SurfacePort; `--engine` flag + `MEDIATION_CLI_ENGINE` env (S2e §3), exit 2 on unknown kind.
- `daemon.ts` — **untracked**, production entry point: everliving OW worker + spawn-isolated leaves, SIGTERM/SIGINT graceful stop.
- `engagement-runner.ts` — **untracked**, child-process leaf entry (join-path/run-id/input/--default-engine/--use-pi), JSON output on stdout.

## 3. PORTS PRESENT vs DESIGNED

Design port list vs code (`src/ports/`):

| Designed port | In code? | Where |
|---|---|---|
| EnginePort | ✅ | `src/ports/engine.ts` (+ new `EngineRegistry` interface in same file) |
| RuntimePort | ✅ | `src/ports/runtime.ts` |
| JoinStore | ✅ | `src/ports/join.ts` |
| DefinitionLoader | ✅ | `src/ports/definition-loader.ts` |
| PackResolver (legacy) | ❌ removed | deleted in `a0eb499` "Remove dead PackResolver production surface after CUT"; only comments remain (`src/app/factory.ts:57`, `wiring.ts:46`, `compose.ts:9` — "no PackResolver dual path") |
| CapabilityStore | ✅ | `src/ports/capability-store.ts` (+ `CapabilityPublisher`) |
| CapabilityResolver | ✅ | `src/ports/capability-resolver.ts` |
| SurfacePort | ✅ | `src/ports/surface.ts` |
| RuntimeHost | ⚠️ adapter-level only | no port file; productized as `createSqliteRuntimeHost` in `src/adapters/openworkflow/host.ts` (ABS-C1) |
| Clock / IdGen | ❌ absent | zero hits for Clock/IdGen in src; ids come from OW (`runId`) and session surfaces (`sessionRef`) |
| NotifyPort | ❌ absent | zero hits for Notify in src; wake delivery rides `sendSignal`/interrupt (D3 L5/P4 marked OPEN in `MIGRATION-SPAWN.md`) |

## 4. TESTS + GATES

- **test/ top-level folders (count of `.test.ts` files):** adapters/capability 3, capability 2, definition 1, domain 2, **engine-selection 9 (untracked, new)**, gauges 1, integration 4, legacy 1, pi 4, ports 2, presence 3, **prime 4 (untracked, new)**, product 1, recipes 1, runtime 17 (incl. untracked ow-worker-spawn + spawn-leaf), surfaces 1 → **56 test files total** (55 `.test.ts` + helpers `test/helpers/{agent-def,fs-pack-plan}.ts`, `test/pi/fake-session.ts`, `test/prime/fake-session.ts`).
- **`npm run check` gate (package.json):** `tsgo --noEmit && npm run lint && npm run test && npm run gauges`.
  - `typecheck`: `tsgo --noEmit` (@typescript/native-preview tsgo, strict + noUnused* per TOOLING.md).
  - `lint`: `oxlint -c oxlint.json` — 230 rules.
  - `test`: `node --experimental-strip-types --test 'test/**/*.test.ts'`.
  - `gauges`: `node --experimental-strip-types scripts/gauges/run.ts`.
- **Gauge scripts in scripts/gauges (each + enforcement):**
  - `run.ts` — orchestrator; `process.exitCode = 1` on any violation.
  - `layer-imports.ts` — `layer_import_violations`: domain/ports/app must not import pi-coding-agent, **prime-agent (added uncommitted)**, @earendil-works/*, openworkflow.
  - `second-door.ts` — `second_door_count`: `createAgentSession(?:FromServices)` allowed ONLY under `src/adapters/pi` and `src/adapters/prime` (parameterized doors, uncommitted change).
  - `export-integrity.ts` — `export_integrity`: every re-export in src/index.ts resolves (dead-export detector).
  - `export-surface.ts` — `public_export_surface`: lists named exports (observational; 203 today).
  - `spawn-death.ts` — `spawn_public_export_count`: no spawn/runner-as-core names or `adapters/legacy` paths on the public index (S11/D3).
  - `pack-plan.ts` — `pack_plan_hash` + `pack_parity_delta` over `fixtures/packs/*` (observational; hash parity must be 0).
- **CURRENT `npm run check` (run by auditor):** **PASS**. typecheck OK · lint "Found 0 warnings and 0 errors" · tests **312 tests / 82 suites / 310 pass / 2 fail=0 / 2 skipped / 0 cancelled** (duration ~13s) · gauges `layer_import_violations=0`, `second_door_count=0`, `export_integrity=0` (checked 85 files/203 symbols), `spawn_public_export_count=0`, `pack_parity_delta=0` — "gauges: OK". (The 2 skips are live-gated suites.)
- **Live suites — `test:live-pi` target:** `MEDIATION_LIVE_PI=1 node --experimental-strip-types --test test/pi/live-pi.test.ts test/integration/live-pi-factory.test.ts test/runtime/live-engagement-leaf-pi.test.ts test/runtime/live-ow-worker-pi.test.ts test/runtime/live-life-health.test.ts`. Live Pi band was green on deepseek/deepseek-v4-flash (EVIDENCE-LIVE-PI.md, HEALTH-REPORT-LIVE-PI.md) except documented H4b/H6b degradations; `test/prime/live-prime.test.ts` is gated by `MEDIATION_LIVE_PRIME=1` (fork auth). All live suites **skip** in default `check`.

## 5. EVIDENCE CULTURE

Chronological (git first-add order; 40 files): S0 → S1 → S2 → S0g → S2b → S5a → S1b → S2c → S5b → S6 → S5c → S7/S3 → S5d → LIVE-PI → S8/S9 → S10 → S11 → ABS-A1..C2/R1 → ABS-WAVE → CUT → PACK-RESOLVER-REMOVAL → PRODUCT-1 → LIFE-P1/P2/P3 → LIVE-HEALTH + S-HARNESS (cf55f55) → **RESTORE-INSTALL, PRIME-ADAPTER, ENGINE-SELECTION (2026-08-07, untracked)**.

| File | Proves |
|---|---|
| `EVIDENCE-S0.md` | Package + domain + ports + boundary gauges baseline |
| `EVIDENCE-S0g.md` | Git baseline + fail-fast toolchain (3503096) + check surface |
| `EVIDENCE-S1.md` | PackResolver v1 search order + toPackSnapshot (Law D0/D2/D4) |
| `EVIDENCE-S2.md` | Factory/EnginePort mock path → Settled |
| `EVIDENCE-S2b.md` | PiEngineAdapter with real createAgentSession |
| `EVIDENCE-S2c.md` | createPiPresenceFactory wires Pi to Settled live |
| `EVIDENCE-S3.md` | Resume fidelity + packSnapshot stability |
| `EVIDENCE-S5a.md` | RuntimePort + engagement leaf + MemoryJoinStore |
| `EVIDENCE-S5b.md` | Leaf + Pi dual path unit |
| `EVIDENCE-S5c.md` | OW worker path (register engagement workflow) |
| `EVIDENCE-S5d.md` | OW worker + createPiPresenceFactory |
| `EVIDENCE-S6.md` | Durable SqliteJoinStore |
| `EVIDENCE-S7.md` | Mediation façade + CLI |
| `EVIDENCE-S8.md` | Reenter recipe + pack gate |
| `EVIDENCE-S9.md` | RunOutcome Parked |
| `EVIDENCE-S10.md` | Plan leaf reuses Gamma engagement |
| `EVIDENCE-S11.md` | Spawn killed as identity; public-export gauge |
| `EVIDENCE-ABS-A1..A8, B1..B3, C1/C2, R1.md` | D5 capability medium independence DAG (each slice: port/domain/adapter + check surface + tip SHA) |
| `EVIDENCE-ABS-WAVE.md` | Rollup of the completed abstraction DAG |
| `EVIDENCE-CUT-capability-cutover.md` | CapabilityResolver sole materialize resolve path |
| `EVIDENCE-PACK-RESOLVER-REMOVAL.md` | Dead PackResolver production surface removed after CUT |
| `EVIDENCE-PRODUCT-1.md` | Durable hosted join default + coding-agent pilot path |
| `EVIDENCE-LIFE-P1/P2/P3.md` | Model P park wait / wake continue / control façade (each records merge tip SHA) |
| `EVIDENCE-LIVE-PI.md` / `EVIDENCE-LIVE-HEALTH.md` | Live Pi band green on deepseek-v4-flash; H1–H7 health matrix + H4b/H6b degradations |
| `EVIDENCE-S-HARNESS.md` | Scenario harness implemented + verified (cf55f55) |
| `EVIDENCE-RESTORE-INSTALL.md` (untracked) | HEAD cf55f55 could not install (bogus committed deps); dep set restored to known-good lockfile; in-flight spawn/plan-DAG work reconciled |
| `EVIDENCE-PRIME-ADAPTER.md` (untracked) | Prime fork adapter slice built; check GREEN 215 pass/2 skip at start (pre engine-selection tests) |
| `EVIDENCE-ENGINE-SELECTION.md` (untracked) | S2e implemented; check GREEN 310 pass/2 skip; not committed |

**outbox/ (tracked + 1 new):** `lint-fixes-result.md` (committed; oxlint violations 430→305, judgment review) and `engine-selection-design.md` (**untracked**, the S2e design spec that the current wave implements). Supporting dirs: `results/` (13 scenario-harness observation outputs, tracked), `fixtures/` (definition + packs goldens; `fixtures/packs/case-basic/agent.yaml` untracked-new for spawn tests), `scenario_harness/` (13 scenarios; 12/13 untracked-new spawn scenarios).

## 6. PRIME + ENGINE SELECTION INTEGRATION (how the wave wires together)

1. **Domain kind** — `src/domain/engine.ts` (untracked): `ENGINE_KINDS`, `resolveEngineKind({override, config, defaultEngine})` → "pi" fallback; `asEngineKind` throws `ENGINE_UNKNOWN` (code added to `src/domain/errors.ts`).
2. **Definition/config layer** — `AgentDefinition.engine` (`src/domain/definition.ts:62`) parsed by `yaml-definition-loader.ts` (known top-level key, fail-closed); `CapabilitySpec.engine` merged root→family→agent (`src/domain/config-layer.ts:112-122`, later layer wins); `capabilitySpecFromDefinition` copies definition.engine into the agent layer (`src/app/factory.ts:85`).
3. **Registry** — `src/adapters/engine-registry.ts` (untracked): lazy, memoized per-kind factories; `pi`/`mock` eager-static, `prime` via **dynamic import** of `./prime/engine-adapter.ts` (module-absent → ENGINE_UNKNOWN, not memoized so it retries). `EngineRegistry` interface lives in `src/ports/engine.ts`.
4. **Factory** — `DefaultPresenceFactory` (`src/app/factory.ts`) accepts `engine` (legacy single-port, unchanged) XOR `registry` (new); materialize resolves `resolveEngineKind({override: opts?.engine, config: spec.engine, defaultEngine})` then `registry.get(kind)`.
5. **CLI** — `src/surfaces/cli.ts`: `--engine` flag > `MEDIATION_CLI_ENGINE` env > legacy `MEDIATION_CLI_PI=1`; unknown → exit 2; default mock for no-keys smoke.
6. **Composition** — `compose.ts`: `createEngineRegistry()` built into both `createLocalMediation` and `createHostedMediation`; `defaultEngine` (S2e) replaces legacy `mockEngine` mapping via `resolveCompositionDefaultEngine`; `spawnConfig.defaultEngine` forwarded to the child runner `--default-engine` so records match the factory.
7. **OW serialization** — `DispatchInput.engine` (`src/ports/runtime.ts:37`) → `toEngagementInput` copies `engine: input.engine` (`src/adapters/openworkflow/runtime.ts:122`) → `EngagementWorkflowInput.engine` (`src/adapters/openworkflow/types.ts:43`); `PlanNodeSpec.engine` forwarded per node (`planNodeToEngagementInput`). Leaf resolves in-run `resolveEngineKind({override: input.engine, config: definition.engine, defaultEngine})` (`workflows/engagement.ts:114-118`) and writes the winning engine into join record + every output variant. `EngagementRecord.engine` (`src/domain/engagement.ts`) recorded by the leaf.
8. **Reenter/wake pinning** — `src/app/mediation.ts`: reenter defaults to join record engine (`record?.engine`), explicit override wins; arc copies `params.input.engine` into the wake continue input (`workflows/engagement-arc.ts` continueInput) — "park→wake MUST pin the run's engine".
9. **Prime adapter** — `src/adapters/prime/*` mirrors pi; shared `EngineSessionHandleBase` in `src/adapters/shared/engine-session-handle.ts` (pi/session-handle.ts shrank 252 lines — extracted). Fork deltas isolated in `create-session.ts` (ModelRegistry.getAll find loop, tools allowlist, no excludeTools → surfaced WARN) and `event-map.ts` (no agent_settled; idle via `waitForIdle`/`mapAgentEndAsIdle`).
10. **Gauges confirm** — `second-door.ts` (uncommitted) parameterized: door regex allowed in BOTH `adapters/pi` and `adapters/prime` → `second_door_count=0`; `layer-imports.ts` (uncommitted) adds `prime-agent` to FORBIDDEN for domain/ports/app → `layer_import_violations=0`; `src/index.ts` exports engine-selection + prime surface (public_export_surface=203).

## 7. KNOWN OPEN BUGS / GAPS (facts, not judgment)

- **park→wake continue broken on real Pi** — default wake/reenter `mode: "continue"` after a full settled park fails: Pi throws `Cannot continue from message role: assistant` (last message is assistant; `session.continue()` is loop-resume legal only after user/tool-result). Documented: commit `e0b0e8a`, `INVESTIGATION-park-wake-continue-design-gap.md`, `HEALTH-REPORT-LIVE-PI.md` ("default park→wake path is **broken for real Pi**"), test `test/runtime/live-life-health.test.ts:340` (H4b). Root cause per investigation: D1 specified a **bridge step** (append whatWasAwaited + payload, then engage); implementation skipped the bridge — `src/app/mediation.ts:189` (`mode: input.mode ?? "continue"`), `src/adapters/openworkflow/signals.ts` (default mode "continue", string shorthand), arc `continueInput` sets `engageMode: wake.mode ?? "continue"` and `task: wake.payloadText` but no bridge message; shared handle `continue()` calls `session.agent?.continue()` with no payload (`src/adapters/shared/engine-session-handle.ts:168-179`). Mock engine has no role guard → LIFE R2/R3 stay green while live fails. Workaround: file sessions + wake/reenter `mode: "prompt"` (HEALTH-REPORT-LIVE-PI.md).
- **H4b / H6b documented degradations** — `test/runtime/live-life-health.test.ts`: H4b (wake default continue fails on real Pi, file session), H6b (inMemory park → reenter continue fails closed — inMemorySession has no resume path).
- **Gap tokens in code:** no TODO/FIXME/HACK in src/; "H4b"/"H6b"/"park-wake"/"Cannot continue from message role" appear only in live-life-health.test.ts and INVESTIGATION/HEALTH docs.
- **Dead / placeholder adapters:**
  - `src/adapters/legacy/spawn-engage.ts` — private fail-closed stub (`SPAWN_DISABLED`); kept per D3 L3 checklist (`MIGRATION-SPAWN.md`: items 4–6 OPEN — external docs/harness may still teach runner-as-core; notify path OPEN; stub deletion OPEN).
  - `src/adapters/capability/registry-store.ts` — in-process registry **stub** (D5 L5): publish→get round-trip, no HTTP, no network (explicit in header + EVIDENCE-ABS-R1.md).
  - `packs/` legacy note — `src/adapters/packs/pack-snapshot.ts` only; `resolve-packs.ts` + `ports/pack-resolver.ts` deleted (`a0eb499`, EVIDENCE-PACK-RESOLVER-REMOVAL.md); "PackResolver" survives only in comments as "no dual path".
  - `planSpec` optional — `runPlan` without planSpec throws (runtime.ts); plan workflow registration is opt-in (`registerPlan` flag).
- **Dependency/install fragility** — committed HEAD `package.json` referenced non-existent packages (`@earendil-works/agent@0.0.8`, `@earendil-works/openworkflow@0.0.4`, `@earendil-works/one-mcp@0.0.6`, `better-sqlite3`); install restored only in the uncommitted diff (EVIDENCE-RESTORE-INSTALL.md; `package-lock.json.npm-bak` kept untracked as known-good backup). `prime-agent` is a `file:` dependency on `/opt/homebrew/lib/node_modules/prime-agent` (machine-local path — not portable).
- **Uncommitted-wave risk** — entire S2e + prime + spawn-leaf/daemon/engagement-runner + 3 evidence files + 2 scenarios + 1 fixture are untracked/modified; `EVIDENCE-ENGINE-SELECTION.md` itself says "Not committed."
