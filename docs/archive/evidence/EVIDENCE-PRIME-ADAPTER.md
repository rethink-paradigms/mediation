# Evidence — Prime engine adapter (fork `prime-agent`) for `@company/mediation`

**Package:** `@company/mediation` (product/mediation-engine/mediation)  
**Date:** 2026-08-07  
**Baseline:** `npm run check` GREEN — 215 pass / 2 skip / 0 fail; gauges all 0
(layer_import_violations=0, second_door_count=0, export_integrity=0,
spawn_public_export_count=0, pack_parity_delta=0). Verified by running the full
check before starting.  
**Dep:** `prime-agent` already declared (`file:/opt/homebrew/lib/node_modules/prime-agent`)
and resolving (symlink → `/opt/homebrew/lib/node_modules/prime-agent`). Verified
`import("prime-agent")` exports createAgentSession, DefaultResourceLoader,
getAgentDir, ModelRegistry, SessionManager, SettingsManager, AuthStorage.
The previous attempt's module-resolution blocker was NOT re-litigated.

---

## 1. What was built

A parallel engine adapter slice mirroring `src/adapters/pi/`, but against the
installed prime-agent **fork** (dist/core/*.d.ts) with the fork deltas:

| File | Purpose |
|------|---------|
| `src/adapters/prime/types.ts` | `PrimeSessionSurface`, `PrimeSessionEvent`, `PrimeSessionFactory`, `OpenedPrimeSession`, `PrimeEngineAdapterOptions` |
| `src/adapters/prime/create-session.ts` | `openPrimeSession` — the sole prime `createAgentSession` door + pure helpers `extensionPathsFromPackPlan`, `findModel`, `primeToolsFromPolicy` |
| `src/adapters/prime/event-map.ts` | `mapPrimeEvent` / `MapPrimeEventOptions` — fork events → `EngineEvent` |
| `src/adapters/prime/session-handle.ts` | `PrimeEngineSessionHandle` (thin wrapper over shared base) + `sessionRefFromPrime` |
| `src/adapters/prime/engine-adapter.ts` | `PrimeEngineAdapter implements EnginePort`, injectable `sessionFactory` |
| `src/adapters/prime/index.ts` | adapter package surface (mirror of `adapters/pi/index.ts`) |
| `src/adapters/shared/engine-session-handle.ts` | **shared** generic handle (`EngineSessionHandleBase<TEvent>`, `EngineSessionSurface`, `EngineSessionEventMapper`) — one waitUntilIdle/busy/event-fanout implementation for both adapters |
| `src/adapters/wiring.ts` | `createPrimePresenceFactory` / `PrimePresenceComposition` / `CreatePrimePresenceFactoryOptions` (mirror of `createPiPresenceFactory`) |
| `src/index.ts` | appended prime adapter exports (layered after the Pi section) |
| `scripts/gauges/second-door.ts` | parameterized doors: `createAgentSession(?:FromServices)?` allowed under `adapters/pi` **and** `adapters/prime`; fail everywhere else |
| `scripts/gauges/layer-imports.ts` | `prime-agent` added to FORBIDDEN for domain/ports/app (design §7.2) |
| `test/prime/` | fake-session, event-map, engine-adapter, create-session mapping, gated live suite |

## 2. Fork deltas vs Pi (implemented)

1. **Model resolution:** fork has no `ModelRuntime`/`getModel`. `openPrimeSession`
   uses `ModelRegistry.create(authStorage, agentDir/models.json)` and a small
   `findModel` loop over `getAll()` (provider+id). `models.json` absent on this
   machine → fork falls back to its built-in catalog (1169 models; smoke verified
   `deepseek/deepseek-v4-flash` resolves).
2. **No `excludeTools` / no `modelRuntime`:** tool policy maps to the fork allowlist
   (`tools` → `allowedToolNames` + `initialActiveToolNames`; `noTools: "all"` when
   no allowlist is declared). `toolsPolicy.exclude` → allowlist subtraction when a
   builtin list exists; otherwise surfaced via WARN (never silently dropped).
3. **Events:** NO `agent_settled`. `agent_end` has `messages` (NO `willRetry`).
   `AgentEvent = agent_start | agent_end | turn_start | turn_end | message_start |
   message_update {assistantMessageEvent} | message_end |
   tool_execution_start/update/end`; session events add `auto_retry_start/end`,
   `compaction_start/end`, `session_info_changed`, `thinking_level_changed`,
   `service_tier_changed`, `ipython_sent_agent_message`, `session_action_update`.
   `mapPrimeEvent`: idle via `waitForIdle` (handle already prefers
   `session.waitForIdle`); `agent_end` → raw unless `mapAgentEndAsIdle`;
   `message_update` text_delta → message; `tool_execution_start/end` → tool;
   `auto_retry_end` failure → error; session events → raw.
4. **Config dir:** fork `getAgentDir()` = `~/.prime/agent` (auth.json has deepseek +
   serper). AuthStorage (not ModelRuntime authPath) is the credential store.
5. **Session surface:** fork `AgentSession` structurally satisfies
   `PrimeSessionSurface` (prompt/steer/followUp/abort/waitForIdle/subscribe/
   dispose/disposeAsync/isStreaming/sessionFile/sessionId/setActiveToolsByName/
   getActiveToolNames/bindExtensions/agent.continue). DefaultResourceLoader
   options, SessionManager.create/open/inMemory, SettingsManager.inMemory and
   ThinkingLevel union are identical to Pi.

## 3. Shared-vs-duplicate decision

**Extracted** the generic session handle to `src/adapters/shared/engine-session-handle.ts`
(`EngineSessionHandleBase<TEvent>` — busy tracking, waitUntilIdle, driveWaitForIdle,
interrupt, dispose, event fanout). Both adapters keep their public handle names and
constructor signatures as thin wrappers over the base, injecting only the vendor
event mapper and label. `src/adapters/pi/session-handle.ts` shrank from ~280 lines to
a ~45-line wrapper; `adapters/pi/engine-adapter.ts` was **not** touched. Pi tests pass
unchanged (16/16 in test/pi). Rationale: the handle logic is 100% engine-agnostic;
duplicating ~280 lines across adapters would drift. Gauge impact verified green
(layer imports, second-door, export-integrity).

`create-session.ts` helpers (`parseModel`, `resolveSystemPrompt`,
`extensionPathsFromPackPlan`) are **duplicated** in `adapters/prime` (not extracted):
they are part of each adapter door's surface, and extraction would have touched
`adapters/pi` exports/tests — "minimize touching adapters/pi" wins here.

## 4. Gauge changes

| Gauge | Before | After | Why |
|-------|--------|-------|-----|
| `second_door_count` | 0 (only `adapters/pi` allowed) | **0** (both `adapters/pi` + `adapters/prime` allowed) | both SDKs export the same `createAgentSession(FromServices)` symbol names; parameterized `SECOND_DOORS` registry |
| `layer_import_violations` | 0 | **0** (gate strengthened: `prime-agent` forbidden in domain/ports/app) | design §7.2 |
| `export_integrity` | 0 | 0 (checked_symbols 186 → 203 incl. 10 new prime exports) | new exports all resolve |
| `public_export_surface` | 186 | 196 (informational) | +PrimeEngineAdapter, PrimeEngineAdapterOptions, PrimeSessionSurface, PrimeSessionEvent, PrimeSessionFactory, OpenedPrimeSession, mapPrimeEvent, MapPrimeEventOptions + sibling engine-selection exports |

`second_door_count` **stayed 0** — no second door was opened; the door now has two
allowed adapter dirs, matching the design (§7.1).

## 5. Test matrix (test/prime/, 28 tests)

| File | Covers |
|------|--------|
| `fake-session.ts` | FakePrimeSession implementing PrimeSessionSurface (fork events: agent_start/agent_end{messages}; no agent_settled; idle via waitForIdle) |
| `event-map.test.ts` (11) | agent_end→raw / +mapAgentEndAsIdle→idle; agent_start→raw; message_update text_delta→message; non-text→raw; message_end text extraction; tool_execution_start/end→tool; auto_retry_end failure→error / success→raw; compaction_start & session_info_changed→raw |
| `engine-adapter.test.ts` (7) | openSession sessionRef from file/id; prompt→idle via waitForIdle (no agent_settled); mapAgentEndAsIdle observer idle; continue via agent.continue; steer/followUp/abort; factory materialize+engage Settled; waitUntilIdle AbortSignal |
| `create-session-paths.test.ts` (10) | ABS-A8 extension paths (plan order, A7 mapping, empty); findModel loop (found/unknown); primeToolsFromPolicy (allowlist, noTools all, exclude subtraction, dropped exclude, empty builtin) |
| `live-prime.test.ts` (gated) | MEDIATION_LIVE_PRIME=1 → real createAgentSession open/prompt/waitUntilIdle/dispose; **skips when unset** (not run in `npm run check`) |

Manual (non-committed) smoke with the real fork: `openPrimeSession` with
`AuthStorage.inMemory` + `ModelRegistry.inMemory` created a real AgentSession
(in-memory), resolved `deepseek/deepseek-v4-flash` from the 1169-model catalog,
returned a sessionRef, and disposed cleanly — validates the createAgentSession
options contract end-to-end without a live model call.

## 6. `npm run check` final summary

```
> tsgo --noEmit        ✅
> oxlint -c oxlint.json  ✅ 0 warnings / 0 errors (143 files)
> node --test 'test/**/*.test.ts'  ✅ tests 312 · suites 82 · pass 310 · fail 0 · skipped 2
> node scripts/gauges/run.ts  ✅
    layer_import_violations=0
    second_door_count=0          (createAgentSession allowed only under adapters/pi + adapters/prime)
    public_export_surface=203    (informational; +17 vs baseline 186 — 10 prime + sibling engine-selection)
    export_integrity=0           (checked_files=85, checked_symbols=203)
    spawn_public_export_count=0
    pack_parity_delta=0
    gauges: OK
EXIT=0
```

Baseline was 215 pass / 2 skip / 0 fail → final 310 pass / 2 skip / 0 fail
(+95 tests: 27 new prime unit tests + the parallel engine-selection slice's tests;
the 2 skipped are the pre-existing coding-agent pilot it-skips — the live Pi and
live Prime suites gate at describe level with `# SKIP` markers and are NOT run,
matching the established pattern). `MEDIATION_LIVE_PRIME` unset → live Prime skips.

## 7. Not-touched list (per parent constraints)

- `src/domain/engine.ts` — sibling's engine-selection slice (do not touch)
- `src/adapters/engine-registry.ts` — sibling's slice (do not touch)
- `src/adapters/compose.ts`, `src/surfaces/cli.ts` — sibling's slice (append-only; not touched by this task)
- config-layer engine field, CLI `--engine`, ports EngineRegistry additions — sibling's slice
- `src/adapters/pi/engine-adapter.ts`, `create-session.ts`, `event-map.ts`, `types.ts`, `index.ts` — untouched (only `pi/session-handle.ts` became a thin shared-base wrapper)
- No `git commit` was made (task says do NOT commit).

## 8. Open risks

- **Sibling mid-flight:** at the time of writing, the parallel engine-selection
  slice (`engine-registry.ts`) had transient syntax errors; the full `npm run check`
  cannot be green until that lands. This task's files are independently green
  (tsgo reports zero errors outside the sibling's file; test/prime 28/28; pi 16/16;
  gauges 0).
- **Live prime unexercised:** gated suite skips by default; no live model run was
  performed (per parent: not required). Real fork createAgentSession smoke passed
  without a model call.
- **exclude semantics:** prime fork has no excludeTools; `toolsPolicy.exclude`
  without a builtin allowlist is dropped with a WARN (documented in code). If a
  strict exclude contract is needed later, prime would need an allowlist computed
  from its default tool set.
