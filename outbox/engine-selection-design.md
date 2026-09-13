# Engine Selection — Runtime Engine Adapter Choice (design spec)

**Slice:** `slice/S2e-engine-selection` (proposed)
**Status:** design spec — implement exactly this; parallel `src/adapters/prime` slice lands beside it.
**Audience:** implementing agent. Design-only: no src/ changes in this review.

---

## 0. Goal

Choose **which engine adapter** (`pi` | `prime` | `mock`, future engines too) runs **which agent at runtime** — orthogonal to the agent: any `AgentDefinition` can run on any engine. The choice must survive:

- **(a) local engage** (CLI / `Mediation.engageLocal`)
- **(b) hosted dispatch** through OpenWorkflow — serialized into workflow input so the worker leaf materializes with the right engine
- **(c) reenter / wake** — resume must reuse the engine that created the session (pin)

Backward-compatible default: **`pi`** (the current real engine), configurable via composition `defaultEngine`. The mock stays first-class (`mock` is a valid `EngineKind`) and remains the CLI's no-keys smoke default via legacy wiring — see §3.

---

## 1. `EngineKind` — where it lives

New file **`src/domain/engine.ts`** (domain layer: no vendor types, no imports of adapters; imported by definition, presence, config-layer, ports, app — no cycles).

```ts
export const ENGINE_KINDS = ["pi", "prime", "mock"] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];

/** Fail-closed parse; throws MediationError("ENGINE_UNKNOWN", …) on anything else. */
export function asEngineKind(value: string): EngineKind;
export function isEngineKind(value: unknown): value is EngineKind;

/** Pure precedence: override > config > defaultEngine > "pi". */
export type EngineResolutionInput = {
  readonly override?: EngineKind;     // per-call (CLI flag, DispatchInput, MaterializeOptions)
  readonly config?: EngineKind;       // effective config-layer engine (incl. definition/agent layer)
  readonly defaultEngine?: EngineKind;// composition default
};
export function resolveEngineKind(input: EngineResolutionInput): EngineKind;
```

Add `"ENGINE_UNKNOWN"` to `MediationErrorCode` in `src/domain/errors.ts`.

### Declaration sites (all three, each with a distinct role)

| Site | Shape | Role |
|---|---|---|
| `AgentDefinition.engine?: EngineKind` | `domain/definition.ts` | **Inert carrier** of `agent.yaml` key `engine:` — the agent's declared default. No I/O, no resolution. |
| `CapabilitySpec.engine?: EngineKind` | `domain/config-layer.ts` | **Policy layer** — root · family · agent merge. Merge rule: **later layer overrides earlier** (identical to `tools.agentMode`). `capabilitySpecFromDefinition` copies `definition.engine` into the agent-layer spec so the merged spec is the single policy source. |
| `MaterializeOptions.engine?`, `EngageLocalInput.engine?`, `ReenterInput.engine?`, `DispatchInput.engine?`, `PlanNodeSpec.engine?`, `SurfaceRequest.engine?`, `SurfaceReenterRequest.engine?` | domain/presence.ts, ports/runtime.ts, ports/surface.ts | **Per-call override** — operator/ad-hoc intent. |

### Resolution precedence (runtime, high → low)

```
1. per-call override        (CLI --engine > env; DispatchInput.engine; MaterializeOptions.engine)
2. effective config-layer   (mergeCapabilitySpecs(...).engine — today the agent layer = definition.engine;
                             root/family layering arrives when the resolver threads real layers)
3. composition defaultEngine (createLocalMediation / createHostedMediation / runner --default-engine)
4. built-in fallback        "pi"
```

**Recommendation rationale:** per-call wins because operator intent is strongest and transient. Config-layer is the policy home (fleet "this agent runs on prime" belongs to family/root config, not per-agent yaml). The definition field is just the agent's own declaration, which the agent layer of the merge already carries — so the definition field and "config" are the same value today; do not double-resolve. Composition default keeps existing programs (tests, daemon) explicit and backwards compatible.

---

## 2. Engine registry / selector shape

### Port — `src/ports/engine.ts`

```ts
import type { EngineKind } from "../domain/engine.ts";

/** Maps EngineKind → EnginePort. App layer depends on this interface, never on adapter classes. */
export interface EngineRegistry {
  get(kind: EngineKind): EnginePort;
  has(kind: EngineKind): boolean;
  readonly kinds: readonly EngineKind[];
}
```

### Adapter implementation — new `src/adapters/engine-registry.ts`

```ts
export type EngineRegistryOptions = {
  readonly pi?: () => EnginePort;      // default: () => new PiEngineAdapter()
  readonly prime?: () => EnginePort;   // default: () => new PrimeEngineAdapter()  (parallel slice)
  readonly mock?: () => EnginePort;    // default: () => new MockEnginePort()
};
export function createEngineRegistry(opts?: EngineRegistryOptions): EngineRegistry;
```

- **Lazy + cached**: factories run on first `get(kind)`; the instance is memoized. Engine constructors are cheap (session open is deferred to `openSession`), so eager is also acceptable — lazy is the safer default.
- Unknown kind → `get` throws `MediationError("ENGINE_UNKNOWN", ...)`.

### App factory — `src/app/factory.ts` (backward compatible)

`DefaultPresenceFactoryDeps` becomes:

```ts
export type DefaultPresenceFactoryDeps = {
  /** Legacy single-engine wiring (unchanged behavior). */
  readonly engine?: EnginePort;
  /** New: runtime selection. Exactly one of engine | registry must be provided. */
  readonly registry?: EngineRegistry;
  /** New: composition fallback for resolveEngineKind (default "pi"). */
  readonly defaultEngine?: EngineKind;
  readonly toPackSnapshot: PackSnapshotFn;
  readonly capabilityResolver: CapabilityResolver;
};
```

`materialize` (delta only):

```ts
const kind = this.registry
  ? resolveEngineKind({
      override: opts?.engine,
      config: capabilitySpecFromDefinition(definition).engine, // agent layer today
      defaultEngine: this.defaultEngine,
    })
  : null;
const engine = kind !== null ? this.registry.get(kind) : this.engine; // legacy path untouched
```

Constructor validates: `(engine === undefined) !== (registry === undefined)` else throw `MediationError("ENGINE_UNKNOWN")`-style wiring error.

### Composition roots — `src/adapters/compose.ts`

- `CreateLocalMediationOptions` / `CreateHostedMediationOptions` gain `readonly defaultEngine?: EngineKind` and `readonly engineRegistry?: EngineRegistry` (test injection).
- `wireMind` builds a registry-backed factory by default: `createEngineRegistry()` + `DefaultPresenceFactory({ registry, defaultEngine, toPackSnapshot, capabilityResolver })`.
- **Legacy mapping preserved:** `mockEngine: false` → `defaultEngine = "pi"`; `mockEngine: true|undefined` → `defaultEngine = "mock"`. Explicit `defaultEngine` wins over legacy `mockEngine`.
- `wiring.ts`: add `createPrimePresenceFactory` beside `createPiPresenceFactory` (parallel slice). Do **not** re-export it from `src/index.ts` (mirrors pi — composition roots only; keeps `spawn_public_export_count` and `export_integrity` green).

---

## 3. CLI — `--engine` flag + env

`src/surfaces/cli.ts`:

- `parseArgs` gains `--engine <pi|prime|mock>` → `CliArgs.engine?: EngineKind`. Unknown value → print help, exit 2 (`asEngineKind` throws; catch and treat as arg error).
- **Env precedence inside the CLI:** `--engine` flag > `MEDIATION_CLI_ENGINE` env > legacy `MEDIATION_CLI_PI=1` (maps to `"pi"`) > definition/config > CLI smoke default `"mock"` (preserved: no-keys local runs keep working).
- `composeDefaultSurface` passes `defaultEngine` into `createLocalMediation` and the parsed engine through `surface.engageLocal({ ..., engine })` (new `SurfaceRequest.engine` field, §6).
- `printHelp` documents both env vars.

**Scope rule:** `MEDIATION_CLI_ENGINE` / `MEDIATION_CLI_PI` are CLI-local. The engagement runner (leaf) must **never** read them — see §4.

---

## 4. Serialization: DispatchInput → EngagementWorkflowInput → leaf

Exact field names (all optional, JSON-safe):

| Type | File | Field |
|---|---|---|
| `DispatchInput` | `ports/runtime.ts` | `readonly engine?: EngineKind` |
| `PlanNodeSpec` | `ports/runtime.ts` | `readonly engine?: EngineKind` (per-node pin in plans) |
| `EngagementWorkflowInput` | `adapters/openworkflow/types.ts` | `readonly engine?: EngineKind` |
| `EngagementWorkflowOutput` (settled \| parked \| failed variants) | `adapters/openworkflow/types.ts` | `readonly engine?: EngineKind` (so join records it) |
| `EngagementRecord` | `domain/engagement.ts` | `readonly engine?: EngineKind` |

Flow:

1. `runtime.ts` `toEngagementInput(input: DispatchInput)` adds `engine: input.engine`.
2. `plan.ts` `planNodeToEngagementInput` adds `engine: node.engine`.
3. `workflows/engagement.ts` `runEngagementLeaf`: `factory.materialize(definition, { resume, cwd, engine: input.engine })`; after materialize write `engine` into the join `put(...)` and into every output variant (settled/parked/failed). Resolve precedence in-leaf: `input.engine ?? definition.engine ?? defaultEngine ?? "pi"` (via `resolveEngineKind`).
4. `workflows/engagement-arc.ts` continue path: `continueInput` **copies `engine: params.input.engine`** (park → wake continue must pin the run's engine).
5. `spawn-leaf.ts` → `engagement-runner.ts` child: `SpawnLeafConfig` gains `readonly defaultEngine?: EngineKind` (keep `usePi?: boolean` legacy → maps to `defaultEngine: "pi"`). Runner arg `--default-engine <kind>` (keep `--use-pi` legacy). Runner resolves `input.engine ?? definition.engine ?? defaultEngine ?? "pi"` and builds its factory via `createEngineRegistry` — replacing the current `if (usePi) piFactory else mock` branch. The runner never inspects `MEDIATION_CLI_*` env (spawn-leaf forwards `env: process.env`, so explicitly ignore it in the runner).
6. `join` schema: `EngagementRecord.engine` written by the leaf; used by reenter pinning (§5).

---

## 5. Reenter / wake — pin the engine

**Rule: resume pins the engine.** A `SessionRef` is engine-specific (Pi = session file path/id; Prime = prime session id). Resuming a Pi ref on Prime must fail fast, never silently fall back.

- `Mediation.reenterFromJoin`: engine = `input.engine ?? record.engine ?? resolved-default`. Lookup `record.engine` from the join record.
- `Mediation.reenter` (direct): `input.engine ?? (join.getBySessionRef(sessionRef)?.engine if join present) ?? resolved-default`.
- Wake (Model P): **no engine override in `WakeSignalData` v1** — the run's engine is pinned in `EngagementWorkflowInput.engine` and copied through the arc. Document `engine?: EngineKind` as a future wake-payload field.
- Adapter-level guard (pitfall §8.3): each adapter validates `req.resume` shape on `openSession`; mismatch → `MediationError("MATERIALIZE_FAILED", ...)` with a clear "resume ref belongs to <other> engine" message.

---

## 6. Surface / Mediation plumbing

- `ports/surface.ts`: `SurfaceRequest.engine?`, `SurfaceReenterRequest.engine?`.
- `adapters/surface/mediation-surface.ts`: forward `engine` in `engageLocal` / `dispatch` / `reenter`.
- `app/mediation.ts`: `EngageLocalInput.engine?`, `ReenterInput.engine?` → passed into `materialize(..., { engine })`; `reenter` pinning per §5.
- `app/recipes/*`: recipe input types extend the above (`DispatchRecipeInput` already extends `DispatchInput`; `ReenterRecipeInput` extends `ReenterInput`) — no recipe code changes needed, just the input types inheriting the new field.

---

## 7. Gauge implications

1. **`second-door.ts` — generalize.** Current rule: `createAgentSession(?:FromServices)?` only under `src/adapters/pi/`. The prime SDK exports the **same symbol names** (`createAgentSession`, `createAgentSessionFromServices`), so the gauge must be parameterized:

   ```ts
   const DOORS: Array<{ name: string; re: RegExp; allowedDirs: string[] }> = [
     { name: "pi-session-door", re: /createAgentSession(?:FromServices)?/gu,
       allowedDirs: [src/adapters/pi, src/adapters/prime] }, // prime SDK reuses the same names
     // future engines append entries with their own door regex + dir
   ];
   ```

   Keep the fail-closed semantics: occurrences outside `allowedDirs` → count → gauge fails.

2. **`layer-imports.ts` — add `prime-agent`** to `FORBIDDEN` (both `from "prime-agent"` and `from "prime-agent/..."`), alongside `pi-coding-agent` / `@earendil-works/*` / `openworkflow`. Domain/ports/app must never import the prime SDK.

3. **`export-integrity.ts` / `spawn-death.ts`** — no change in logic. Discipline: `createPrimePresenceFactory`, `PrimeEngineAdapter`, and `createEngineRegistry` may be exported from `src/index.ts` **only if** we choose to make them public (pi precedent: `PiEngineAdapter` is public). Minimum viable: export `EngineKind`, `asEngineKind`, `resolveEngineKind`, `EngineRegistry` type; keep prime adapter exports composition-only until the prime slice lands. Whatever is exported must exist (export-integrity is a hard gate).

---

## 8. Test matrix

**Unit — domain:**
- `test/domain/engine.test.ts` (new): `resolveEngineKind` precedence (override > config > default > fallback "pi"; each position independently); `asEngineKind` accepts 3 kinds, throws `ENGINE_UNKNOWN` otherwise; `isEngineKind` narrows.
- `test/domain/config-layer.test.ts` (extend): `CapabilitySpec.engine` merge — later layer overrides; root→family→agent order even when input scrambled (mirror `tools.agentMode` cases); agent-layer engine comes from `capabilitySpecFromDefinition`.
- `test/definition/yaml-definition-loader.test.ts` (extend): `engine: prime` maps onto `AgentDefinition.engine`; `engine: bogus` → `DEFINITION_INVALID`; unknown key passthrough still puts `engine` into KNOWN keys (not `meta`).

**Unit — composition/factory:**
- `test/adapters/engine-registry.test.ts` (new): `get/has/kinds`; lazy creation memoizes; defaults (pi/prime/mock) constructible; custom factories override.
- `test/app/factory.test.ts` (extend): `DefaultPresenceFactory` with `registry` + per-call `MaterializeOptions.engine` picks the right `EnginePort` (use counting fake ports); legacy `engine`-only deps behave exactly as before (no regression); both-provided/neither → wiring error.

**Integration — same agent on two engines:**
- `test/integration/engine-selection.test.ts` (new, fake session surfaces): one `AgentDefinition` engaged via pi-fake and prime-fake factories → both `settled`, same `packSnapshot.planHash`, same `sessionRef` shape contract per engine.

**Hosted — serialization:**
- `test/runtime/ow-engine-dispatch.test.ts` (new or extend `ow-worker-*`): dispatch with `engine` → `EngagementWorkflowInput.engine` present on the worker; leaf materializes via the registry-backed factory with that engine (in-process host, injected fake registry); join record stores `engine`; output carries `engine`. `planNodeToEngagementInput` forwards per-node engine.

**Resume — pinning:**
- `test/integration/reenter-engine-pin.test.ts` (new): dispatch(park) with `engine: "prime"` → wake continue uses prime (arc copies `input.engine`); `reenterFromJoin` defaults to `record.engine`; explicit override wins; resume-ref/engine mismatch fails fast with a clear error code.

**CLI:**
- `test/surfaces/cli-args.test.ts` (new or extend): `--engine` parsing; `--engine` > `MEDIATION_CLI_ENGINE` > `MEDIATION_CLI_PI`; unknown `--engine` → exit 2; no flags → CLI smoke default mock unchanged.

---

## 9. Minimal diff plan (file-by-file, implementation order)

| # | File | Change |
|---|---|---|
| 1 | `src/domain/engine.ts` (new) | `ENGINE_KINDS`, `EngineKind`, `asEngineKind`, `isEngineKind`, `resolveEngineKind` |
| 2 | `src/domain/errors.ts` | add `"ENGINE_UNKNOWN"` code |
| 3 | `src/domain/definition.ts` | `AgentDefinition.engine?: EngineKind` |
| 4 | `src/domain/config-layer.ts` | `CapabilitySpec.engine?`; merge rule later-overrides; include in `EffectiveCapabilitySpec` |
| 5 | `src/domain/presence.ts` | `MaterializeOptions.engine?` |
| 6 | `src/domain/engagement.ts` | `EngagementRecord.engine?` |
| 7 | `src/ports/engine.ts` | `EngineRegistry` interface |
| 8 | `src/ports/runtime.ts` | `DispatchInput.engine?`, `PlanNodeSpec.engine?` |
| 9 | `src/ports/surface.ts` | `SurfaceRequest.engine?`, `SurfaceReenterRequest.engine?` |
| 10 | `src/adapters/engine-registry.ts` (new) | `createEngineRegistry` (lazy, cached; pi/prime/mock defaults) |
| 11 | `src/app/factory.ts` | deps `engine?` \| `registry?` + `defaultEngine?`; materialize resolves + picks port; `capabilitySpecFromDefinition` includes engine |
| 12 | `src/app/mediation.ts` | `EngageLocalInput.engine?`, `ReenterInput.engine?`; pass to materialize; reenter pin from join |
| 13 | `src/adapters/definition/yaml-definition-loader.ts` | schema `engine: z.enum(ENGINE_KINDS)`, map to def, add to `KNOWN_TOP_KEYS` |
| 14 | `src/adapters/compose.ts` | options `defaultEngine?`, `engineRegistry?`; wireMind registry factory; legacy `mockEngine` mapping |
| 15 | `src/adapters/wiring.ts` | (parallel slice) `createPrimePresenceFactory`; optional `createEngineRegistry` re-export |
| 16 | `src/adapters/openworkflow/types.ts` | `EngagementWorkflowInput.engine?`; `engine?` on all output variants |
| 17 | `src/adapters/openworkflow/runtime.ts` | `toEngagementInput` maps `engine` |
| 18 | `src/adapters/openworkflow/workflows/engagement.ts` | materialize with `engine: input.engine`; join + output carry engine |
| 19 | `src/adapters/openworkflow/workflows/engagement-arc.ts` | `continueInput` copies `engine: params.input.engine` |
| 20 | `src/adapters/openworkflow/workflows/plan.ts` | `planNodeToEngagementInput` maps `node.engine` |
| 21 | `src/adapters/openworkflow/spawn-leaf.ts` | `SpawnLeafConfig.defaultEngine?` (keep `usePi`); pass `--default-engine` |
| 22 | `src/surfaces/engagement-runner.ts` | parse `--default-engine`; registry factory; ignore `MEDIATION_CLI_*` |
| 23 | `src/surfaces/cli.ts` | `--engine`; `MEDIATION_CLI_ENGINE`; legacy `MEDIATION_CLI_PI`; pass `defaultEngine` + override |
| 24 | `src/adapters/surface/mediation-surface.ts` | forward `engine` in engageLocal/dispatch/reenter |
| 25 | `scripts/gauges/second-door.ts` | parameterized DOORS with per-door allowed dirs (pi + prime) |
| 26 | `scripts/gauges/layer-imports.ts` | add `prime-agent` to FORBIDDEN |
| 27 | `src/index.ts` | export `EngineKind`, `asEngineKind`, `resolveEngineKind`, `EngineRegistry`; prime adapter exports only after its slice (composition-only) |
| 28 | tests | §8 matrix |

Ordering note: 1–9 are pure domain/port (no behavior change); 10–14 make local selection real; 16–22 make hosted selection real; 25–26 keep gauges green alongside the prime adapter landing.

---

## 10. Pitfalls

1. **`file:` dep on prime-agent SDK.** `prime-agent` (v0.7.0, global at `/opt/homebrew/lib/node_modules/prime-agent`) is not a workspace dep; mediation is **excluded from the pnpm workspace** (`pnpm-workspace.yaml`: `!product/mediation-engine/mediation`, "broken manifest"). Add `"prime-agent": "file:/opt/homebrew/lib/node_modules/prime-agent"` to `package.json` dependencies (or the agreed file-reference mechanism) **before** the prime adapter imports it. Do not worsen the workspace exclusion; keep deps minimal.
2. **Name collision in the second-door gauge.** Both SDKs export `createAgentSession(FromServices)`. The gauge must allow `src/adapters/prime` too (§7.1) or the hard gate fails the moment the prime adapter lands. Keep imports distinct by module specifier (`@earendil-works/pi-coding-agent` vs `prime-agent`) — never import pi's door from `adapters/prime` or vice versa.
3. **Per-engine session refs.** `SessionRef` is not portable. Pin on resume (§5) and fail fast on mismatch. Never attempt to resume a Pi session file on the prime adapter (and the reverse).
4. **Engine pinning on resume.** The arc's continue path and `reenterFromJoin` must reuse the recorded engine, or the run fails with format/role errors (e.g., the documented H4b `Cannot continue from message role: assistant` family). Copying `engine` through `continueInput` is mandatory, not optional.
5. **Validation of unknown kinds — fail closed.** `asEngineKind`/`resolveEngineKind` throw; CLI exits 2; a workflow input carrying `engine: "bogus"` must fail the leaf fast (`ENGINE_UNKNOWN`), **never** silently fall back to pi. Absence of the field is the only path to defaults.
6. **Env leakage into spawn leaves.** `spawn-leaf.ts` forwards `env: process.env`; the runner must ignore `MEDIATION_CLI_ENGINE` / `MEDIATION_CLI_PI` and rely on the serialized `input.engine` + `--default-engine`. Document this so nobody "fixes" the runner by reading the env.
7. **Mock must not become the silent default for real runs.** `mock` is explicit-only at the composition level (`defaultEngine: "mock"` or legacy `mockEngine: true`); the built-in fallback is `pi`. The CLI keeps mock as its no-keys smoke default but passes it explicitly.
8. **Prime event-model deltas.** Prime has no `agent_settled`; `waitUntilIdle` is primary and `agent_end` carries messages without `willRetry`. `settled-policy.ts` / presence already key off idle snapshots — verify idle-based settle works for prime and that `PARK_CONTINUE_FAILED` handling doesn't regress with engine selection (H4b/H6b degradations stay documented, not worsened).
9. **Gauges are hard gates.** Any export of prime adapter symbols from `src/index.ts` must be intentional (export-integrity + spawn-death fail otherwise). Keep `createPrimePresenceFactory` composition-only until a product decision makes it public.
10. **`resolveDefinition` in the leaf loads yaml** — it now sees `engine:` too. If an input engine contradicts the definition engine, **input wins** (per-call precedence) — do not "helpfully" override the serialized choice with the yaml value.

---

## 11. Non-goals / open (explicitly out of scope)

- Full root/family config-layer threading through `CapabilityResolver` (engine merge rules exist and are unit-tested; the factory today consumes the agent layer only).
- Engine migration of an existing session (reenter across engines is fail-fast, not a migrator).
- Per-node engine in `WakeSignalData` (future).
- Prime adapter implementation itself (parallel slice; this spec only defines the seam it plugs into).
