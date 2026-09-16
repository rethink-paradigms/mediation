# EVIDENCE — ENGINE SELECTION (S2e)

**Slice:** `slice/S2e-engine-selection` — runtime engine adapter choice (`pi` | `prime` | `mock`), per `outbox/engine-selection-design.md`.
**Status:** implemented; `npm run check` GREEN (310 pass / 2 skip / 0 fail; gauges 0). Not committed.

---

## What shipped

Runtime engine selection: any `AgentDefinition` can run on any engine. The choice survives local engage (CLI / `Mediation.engageLocal`), hosted dispatch through OpenWorkflow (serialized into workflow input), and reenter/wake (engine pinned by the join record). Backward-compatible default **`pi`** at composition level; mock stays explicit-only except the CLI's no-keys smoke default (passed explicitly).

Resolution precedence (high → low, implemented in `resolveEngineKind`):

```
1. per-call override   (--engine / MEDIATION_CLI_ENGINE; DispatchInput.engine;
                        MaterializeOptions.engine; ReenterInput.engine)
2. effective config    (mergeCapabilitySpecs(...).engine — agent layer today =
                        definition.engine via capabilitySpecFromDefinition)
3. composition default (createLocalMediation / createHostedMediation
                        defaultEngine; runner --default-engine)
4. built-in fallback   "pi"
```

Fail-closed everywhere: `asEngineKind` throws `ENGINE_UNKNOWN` on unknown kinds; a bogus serialized workflow `engine` fails the leaf fast with a `failed` output carrying `ENGINE_UNKNOWN` (never a silent pi fallback); the CLI exits 2 on unknown `--engine` / `MEDIATION_CLI_ENGINE`.

## Ownership

**This slice (files created/changed):**

| File | Change |
|---|---|
| `src/domain/engine.ts` (new) | `ENGINE_KINDS`, `EngineKind`, `asEngineKind`, `isEngineKind`, `resolveEngineKind` (pure, fail-closed) |
| `src/domain/errors.ts` | added `"ENGINE_UNKNOWN"` code |
| `src/domain/definition.ts` | `AgentDefinition.engine?: EngineKind` (inert carrier of `agent.yaml` key `engine:`) |
| `src/domain/config-layer.ts` | `CapabilitySpec.engine?`, `EffectiveCapabilitySpec.engine?`; merge rule later-layer-overrides (identical to `tools.agentMode`) |
| `src/domain/presence.ts` | `MaterializeOptions.engine?` |
| `src/domain/engagement.ts` | `EngagementRecord.engine?` (join pins the run's engine) |
| `src/ports/engine.ts` | `EngineRegistry` interface (`get(kind): Promise<EnginePort>` — async to support lazy dynamic import; `has`; `kinds`) |
| `src/ports/runtime.ts` | `DispatchInput.engine?`, `PlanNodeSpec.engine?` |
| `src/ports/surface.ts` | `SurfaceRequest.engine?`, `SurfaceReenterRequest.engine?` |
| `src/adapters/engine-registry.ts` (new) | `createEngineRegistry` — lazy + memoized factories; pi/mock defaults; prime via dynamic import; unknown → `ENGINE_UNKNOWN` |
| `src/app/factory.ts` | `DefaultPresenceFactoryDeps`: `engine?` \| `registry?` (exactly one, wiring error otherwise) + `defaultEngine?`; materialize resolves precedence and picks the port; `capabilitySpecFromDefinition` copies `definition.engine` |
| `src/app/mediation.ts` | `EngageLocalInput.engine?`, `ReenterInput.engine?`; reenter pins engine from join record (`reenterFromJoin`: `input.engine ?? record.engine`; direct `reenter`: `input.engine ?? join.getBySessionRef(...)?.engine`) |
| `src/adapters/definition/yaml-definition-loader.ts` | schema `engine: z.enum(ENGINE_KINDS)` (bogus → `DEFINITION_INVALID`); mapped onto `AgentDefinition.engine`; added to `KNOWN_TOP_KEYS` (not residual `meta`) |
| `src/adapters/compose.ts` | `CreateLocalMediationOptions` / `CreateHostedMediationOptions`: `defaultEngine?`, `engineRegistry?`; `wireMind` builds a registry-backed factory (`createEngineRegistry()`); legacy `mockEngine:false→"pi"`, `mockEngine:true|undefined→"mock"` via `resolveCompositionDefaultEngine`; legacy `pi:` options → custom pi registry factory; hosted threads `defaultEngine` into the host + spawn config |
| `src/adapters/surface/mediation-surface.ts` | forwards `engine` in engageLocal / dispatch / reenter |
| `src/adapters/openworkflow/types.ts` | `EngagementWorkflowInput.engine?`; `engine?` on settled \| parked \| failed output variants |
| `src/adapters/openworkflow/runtime.ts` | `toEngagementInput` maps `engine: input.engine` |
| `src/adapters/openworkflow/workflows/engagement.ts` | leaf resolves in-leaf precedence (`input.engine ?? definition.engine ?? defaultEngine ?? "pi"`), materializes with `engine: input.engine`, writes `engine` into join `put` + every output variant; bogus engine → failed output `ENGINE_UNKNOWN` |
| `src/adapters/openworkflow/workflows/engagement-arc.ts` | `continueInput` **copies `engine: params.input.engine`** (park→wake pins); threads `defaultEngine` to the leaf |
| `src/adapters/openworkflow/workflows/plan.ts` | `planNodeToEngagementInput` maps `engine: node.engine`; `PlanLeafDeps.defaultEngine?` threaded to node leaves |
| `src/adapters/openworkflow/spawn-leaf.ts` | `SpawnLeafConfig.defaultEngine?` (legacy `usePi:true→"pi"`, `usePi:false→"mock"`); passes `--default-engine <kind>` to the child (legacy `--use-pi` retained for external callers) |
| `src/adapters/openworkflow/register-engagement.ts` | `RegisterEngagementWorkflowDeps.defaultEngine?` threaded to the arc → leaf |
| `src/adapters/openworkflow/register-plan.ts` | `RegisterPlanWorkflowDeps.defaultEngine?` threaded to node leaves |
| `src/adapters/openworkflow/host.ts` | `CreateSqliteRuntimeHostOptions.defaultEngine?` → registration deps |
| `src/adapters/join/sqlite-store.ts` | `engine TEXT` column + `ensureEngineColumn` migration (PRAGMA table_info + ALTER TABLE ADD COLUMN for pre-existing DBs); round-trips `EngagementRecord.engine` |
| `src/surfaces/cli.ts` | `--engine <kind>`; env precedence `--engine > MEDIATION_CLI_ENGINE > MEDIATION_CLI_PI=1 ("pi") > definition/config > CLI smoke default "mock"` (passed explicitly); unknown flag/env → help + exit 2; `printHelp` documents both env vars |
| `src/surfaces/engagement-runner.ts` | parses `--default-engine` (keeps `--use-pi` legacy → `"pi"`); builds registry-backed `DefaultPresenceFactory` (replaces `if (usePi) piFactory else mock`); **never reads `MEDIATION_CLI_*`** (spawn-leaf forwards `process.env`; the leaf engine comes only from serialized input + `--default-engine`) |
| `src/index.ts` | appended engine-selection exports: `ENGINE_KINDS`, `asEngineKind`, `isEngineKind`, `resolveEngineKind`, `EngineKind`, `EngineResolutionInput`, `EngineRegistry`, `createEngineRegistry`, `EngineRegistryOptions` (file appended, not rewritten) |
| `scripts/gauges/layer-imports.ts` | `prime-agent` added to FORBIDDEN (from/require/import forms). NOTE: the parallel prime slice landed the same edit concurrently — the file already carried it; verified present, no further edit made by this slice |
| `test/engine-selection/**` (new) | full §6 matrix, see below |
| `test/domain/config-layer.test.ts` (extend) | engine merge cases (later-overrides, scrambled order, absent) |
| `test/definition/yaml-definition-loader.test.ts` (extend) | `engine: prime` maps; `engine: bogus` → `DEFINITION_INVALID`; engine is KNOWN key (not meta) |

**Parallel slice owns (NOT touched by this slice):** `src/adapters/prime/**`, `test/prime/**`, `src/adapters/shared/**`, `scripts/gauges/second-door.ts`, `src/adapters/wiring.ts` (`createPrimePresenceFactory`), `src/adapters/pi/**` internals (including `session-handle.ts` generalization), `scenario_harness/**`, their EVIDENCE files (`EVIDENCE-PRIME-ADAPTER.md`), `package.json`/lockfile dependency edits.

## Lazy-prime seam

- No static import of `adapters/prime` anywhere in this package (typecheck stays green whether or not the prime adapter exists).
- `createEngineRegistry` resolves `"prime"` on first `get("prime")` via **dynamic `import()` of `src/adapters/prime/engine-adapter.ts`**, wrapped: module missing or `PrimeEngineAdapter` not exported → `MediationError("ENGINE_UNKNOWN", …)` with a clear message.
- Resolutions are memoized (first get wins; concurrent gets share the promise); a **failed load is NOT memoized** — a later `get` retries (e.g. the adapter landing mid-process).
- `EngineRegistry.get` is `Promise<EnginePort>` (slight deviation from the design spec's sync sketch) precisely to support the mandated lazy dynamic import; the app factory `await`s it.
- Test seam: `EngineRegistryOptions.primeModule` overrides the module specifier so the module-absent path is tested deterministically without touching the real adapter dir.
- Prime adapter landed mid-slice (parallel task); `get("prime")` now resolves to a real `PrimeEngineAdapter` (verified in `engine-registry.test.ts` via `constructor.name`, no static import).

## Serialization (field names, all optional / JSON-safe)

| Type | File | Field |
|---|---|---|
| `DispatchInput` | `ports/runtime.ts` | `readonly engine?: EngineKind` |
| `PlanNodeSpec` | `ports/runtime.ts` | `readonly engine?: EngineKind` |
| `EngagementWorkflowInput` | `adapters/openworkflow/types.ts` | `readonly engine?: EngineKind` |
| `EngagementWorkflowOutput` (settled \| parked \| failed) | `adapters/openworkflow/types.ts` | `readonly engine?: EngineKind` |
| `EngagementRecord` | `domain/engagement.ts` | `readonly engine?: EngineKind` |

Flow: `runtime.ts toEngagementInput` maps `input.engine` → `EngagementWorkflowInput.engine`; `plan.ts planNodeToEngagementInput` maps `node.engine`; leaf materializes with `engine: input.engine` and records the resolved engine (`input.engine ?? definition.engine ?? defaultEngine ?? "pi"`) into join + outputs; arc `continueInput` copies `engine` so park→wake pins the run's engine; spawn leaf forwards `--default-engine` to the runner (legacy `--use-pi` retained).

## Test matrix (spec §8) — result

| Area | File(s) | Result |
|---|---|---|
| domain resolution precedence (override > config > default > "pi"; each position independently) | `test/engine-selection/domain-engine.test.ts` | ✔ |
| `asEngineKind` 3 kinds + throws `ENGINE_UNKNOWN`; `isEngineKind` narrows | same | ✔ |
| config-layer merge (later overrides; scrambled order; absent) + `capabilitySpecFromDefinition` | `test/engine-selection/config-layer-engine.test.ts`, `test/domain/config-layer.test.ts` (extend) | ✔ |
| yaml: `engine: prime` maps; `engine: bogus` → `DEFINITION_INVALID`; KNOWN key (not meta) | `test/engine-selection/yaml-definition-engine.test.ts`, `test/definition/yaml-definition-loader.test.ts` (extend) | ✔ |
| registry: get/has/kinds; lazy memoized; defaults (pi/mock) constructible; prime lazy (now resolves; absent path via `primeModule` seam → `ENGINE_UNKNOWN`); custom factories override; failed load retried | `test/engine-selection/engine-registry.test.ts` | ✔ |
| factory: registry + per-call `MaterializeOptions.engine` picks right port (counting fakes); precedence incl. definition.engine; legacy engine-only deps unchanged; both/neither wiring error; unknown override → `ENGINE_UNKNOWN` | `test/engine-selection/factory-engine.test.ts` | ✔ |
| same-agent pi-vs-mock integration: both settle, same `packSnapshot.planHash`, per-engine sessionRef | `test/engine-selection/integration-same-agent.test.ts` | ✔ |
| hosted dispatch serialization: `engine` on worker input; leaf via registry-backed factory; join + output carry engine; round-trip default; `planNodeToEngagementInput` forwards node engine; bogus engine → failed leaf `ENGINE_UNKNOWN` | `test/engine-selection/ow-engine-dispatch.test.ts` | ✔ |
| resume pinning: arc copies `input.engine` park→wake; `reenterFromJoin` defaults to `record.engine`; explicit override wins; direct reenter reuses join engine; leaf output engine matches materialize | `test/engine-selection/reenter-engine-pin.test.ts` | ✔ |
| CLI: `--engine` parsing; `--engine` > `MEDIATION_CLI_ENGINE`; legacy `MEDIATION_CLI_PI=1` leaves override unset (composition default); unknown flag/env → exit 2; no flags → mock smoke default; help documents env | `test/engine-selection/cli-engine-args.test.ts` | ✔ |

Manual smoke (process level): `cli.ts engage` on `fixtures/packs/case-basic` → `settled` (mock), exit 0; `--engine bogus` → exit 2; `--engine mock` → `settled`, exit 0.

## Check summary (final)

```
npm run check  →  rc=0
  tsgo --noEmit           OK (0 errors)
  oxlint                  Found 0 warnings and 0 errors
  node --test             tests 312  suites 82  pass 310  fail 0  skipped 2
  gauges                  OK
    layer_import_violations=0
    second_door_count=0
    public_export_surface=203
    export_integrity=0
    spawn_public_export_count=0
    pack_parity_delta=0 (case-basic ok=true)
```

Baseline before this slice: 217 tests (215 pass / 2 skip / 0 fail), gauges 0. Delta: +95 tests (this slice's 61 engine-selection + 6 extended assertions + parallel slice's test/prime suite). The 2 skips are the live-Pi suites (gated on `MEDIATION_LIVE_PI=1`), unchanged.

## Open risks / notes

1. **`EngineRegistry.get` is async** (`Promise<EnginePort>`) — a deliberate, documented deviation from the design spec's sync sketch, required by the parent-mandated lazy dynamic import of the prime adapter (robust to top-level await in the future adapter module). All callers (app factory) are async.
2. **Join records for legacy single-engine wiring** (`DefaultPresenceFactory({ engine })`): the leaf's in-leaf resolution still records a resolved engine (default "pi") even though the legacy factory ignores `MaterializeOptions.engine`. Registry-backed composition paths (compose / runner / hosted) keep records truthful because the leaf's `defaultEngine` mirrors the factory's. Documented; engine selection is a registry-wiring feature.
3. **Adapter-level resume-ref mismatch guards** (pitfall §8.3, "resume ref belongs to <other> engine" → `MATERIALIZE_FAILED`) are owned by the engine adapters (pi/prime) — out of this slice's scope (adapters/pi|prime internals untouched; mock accepts any resume ref by design).
4. **`layer-imports.ts` prime-agent FORBIDDEN entries**: the parallel prime slice landed the same edit concurrently; verified present and correct (from/require/import). This slice made no further edit to avoid clobbering.
5. **Second-door gauge generalization** (parameterized DOORS incl. `src/adapters/prime`) is owned by the parallel slice; `second_door_count=0` holds with their landed generalization.
6. **`createPrimePresenceFactory` / `PrimeEngineAdapter` are NOT re-exported from `src/index.ts`** (composition-only per spec §7.3); `export_integrity=0` and `spawn_public_export_count=0` hold.
7. Transient `node_modules` / concurrent-edit states during parallel development: full check re-run after both slices' latest edits — green. If it regresses for prime-slice reasons, re-run after that slice settles.
8. Not committed (per instruction). Working tree contains the parallel slice's uncommitted files as well.
