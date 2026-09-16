# Live system health report — @company/mediation

## POST-FIX UPDATE (2026-08-11, POLISH wave — issue #5)

The degraded verdict below predates the park-wake bridge fix (issue #1, merge
`51631d7`). Re-run on 2026-08-11 (tip `a0b3eca` + POLISH, model
`deepseek/deepseek-v4-flash`, auth `~/.pi/agent/auth.json`):

- `MEDIATION_LIVE_PI=1 npm run test:live-pi` → **13/13 pass** (incl. H4b: wake
  default continue after settled park → Settled same sessionRef, via the D1
  bridge; H5 fail-closed capability; H6 reenter; H7 two-node runPlan).
- `MEDIATION_LIVE_PI=1 node --experimental-strip-types --test
  test/runtime/live-park-wake-pi.test.ts` → **2/2 pass** (L-W1 hosted
  park→wake default continue → Settled; L-W2 local park → reenter default
  continue → Settled).
- `MEDIATION_LIVE_PRIME=1 node --experimental-strip-types --test
  test/prime/live-prime.test.ts` → **1/1 pass** (prime engine smoke).

Verdict now: **HEALTHY for real Pi + DeepSeek, default continue path fixed.**
The default `wake.mode ?? "continue"` / reenter `continue` path (previously
the live-breaking defect) is the *tested default* again. The one documented
constraint that remains: `inMemorySession` cannot resume a parked session for
continue (H6b fails closed with a clear error) — file sessions are required
for continuum, as always. Details: `EVIDENCE-POLISH.md`.

## Executive verdict (original, 2026-07-17 — superseded by the update above)

**Degraded but operationally usable for real Pi + DeepSeek.** Cold engage, factory materialize, leaf, OW worker dispatch, hosted Mediation continuum (settle + join), explicit park, fail-closed capability, file-session park→wake with `mode: "prompt"`, reenter with `mode: "prompt"`, and two-node `runPlan` all **pass live**. The default park→wake path is **broken for real Pi**: after a full settled park the last message is assistant, and Pi rejects `session.continue()` (`Cannot continue from message role: assistant`). Mock continuum green-lights the default `wake.mode ?? "continue"` path that fails under real mind. `inMemorySession` cannot resume for continuum either. Product ops should use **file sessions + wake/reenter `mode: "prompt"`** until the default continue semantic is fixed.

## Environment

| Item | Value |
|------|--------|
| Date (UTC) | 2026-07-17T22:13Z |
| Model | `deepseek/deepseek-v4-flash` |
| Thinking | `off` |
| Auth | `~/.pi/agent/auth.json` present |
| Node | v26.0.0 |
| Package tip SHA | `a2b6725ad5fbc87e11d84be9f9fba697798693ad` (LIFE-P3: record merge tip in evidence.) |
| Gate | `MEDIATION_LIVE_PI=1` |
| Keyless wall | `npm run check` green (live suites skip) |

## Method

1. Ran existing live band (engine, factory, leaf, OW worker) — baseline 4/4.
2. Invented health matrix H1–H7 (+ H4b, H6b degradations) against product doors: `createLocalMediation`, `createHostedMediation({ mockEngine: false })`, `engageLocal`, `dispatch`/`wait`/`wake`, `reenter`, `runPlan`.
3. Added gated suite `test/runtime/live-life-health.test.ts`; wired into `npm run test:live-pi`.
4. Observed H4/H6 failures under `inMemory` and under default `continue`; adjusted success paths to file session + `mode: "prompt"` and encoded degradations as intentional assertions (H4b, H6b).
5. Full live band re-run: **13/13 pass** in ~15.4s. Keyless `npm run check` remains green.

Commands:

```bash
cd company/product/mediation-engine/mediation
MEDIATION_LIVE_PI=1 MEDIATION_LIVE_MODEL=deepseek/deepseek-v4-flash npm run test:live-pi
npm run check   # must stay keyless / live-skipped
```

## Scenario results table

| ID | Scenario | Door | Result | Notes / evidence |
|----|----------|------|--------|------------------|
| L1 | openSession + prompt + idle | `PiEngineAdapter` | **PASS** | ~1.3s; idle reason `agent_settled` |
| L2 | materialize + engage Settled | `createPiPresenceFactory` | **PASS** | ~1.5s; trail engaging→idle |
| L3 | runEngagementLeaf Settled | leaf + Pi factory | **PASS** | sessionRef + pack hash; join settled |
| L4 | OW worker dispatch→wait | RuntimePort + worker | **PASS** | completed + settled result |
| H1 | engageLocal Settled | `createLocalMediation` real Pi | **PASS** | ~1.2–1.5s |
| H2 | hosted dispatch→wait + join | `createHostedMediation` real Pi | **PASS** | join.sessionRef == result.sessionRef |
| H3 | engageLocal parkIntent | local monocoque | **PASS** | Parked after real mind idle; reason preserved |
| H4 | park→wake→Settled same session | hosted file session, wake `mode: "prompt"` | **PASS** | Session resumed from `.jsonl`; same sessionRef |
| H4b | park→wake default continue | hosted file session, omit mode | **PASS (documents failure)** | completed + failed leaf: `Cannot continue from message role: assistant` |
| H5 | missing capability fail-closed | hosted real factory, bad extensions | **PASS** | ~100ms; no model open; `CAPABILITY_RESOLVE_FAILED` |
| H6 | park→reenter same session | local file session, `mode: "prompt"` | **PASS** | pack gate match; identical sessionRef path |
| H6b | park→reenter inMemory continue | local inMemory | **PASS (documents failure)** | resume path missing → new session; `No messages to continue from` |
| H7 | runPlan 2 nodes | hosted + registerPlan | **PASS** | both nodes settled; ~2.1–2.5s |

**Live totals:** 13 tests, 13 pass, 0 fail (~15.4s wall for full `test:live-pi`).

## Outcomes that prove life

- **One Pi door works end-to-end** under DeepSeek V4 Flash (auth + ModelRegistry).
- **Monocoque product doors live:** `engageLocal`, factory materialize/engage, leaf, worker dispatch.
- **Hosted Mediation + real mind:** `createHostedMediation({ mockEngine: false })` → dispatch → worker → Settled → join correlation truth.
- **Explicit park after real idle** (`parkIntent`) returns Parked with reason/resumeToken — not mock-only.
- **File-session continuum works** when wake/reenter use **prompt** as next user turn: same `sessionRef` path, Settled.
- **Fail-closed capability** holds on real factory wiring: missing extension → failed leaf without opening Pi session.
- **Multi-node plan** runs two real mind turns sequentially via `runPlan`.

## Failures and degradations

### 1. Default wake continue after settled park fails on real Pi — **MAJOR**

- **Symptoms:** After `parkIntent` park (mind idled with assistant last message), `mediation.wake(runId, { payloadText })` (default mode continue via engagement-arc) completes the OW run with `result.kind: "failed"`, code `ENGAGE_FAILED`, message `Cannot continue from message role: assistant`. File resume itself succeeds (same sessionRef).
- **Reproduction:**
  ```bash
  MEDIATION_LIVE_PI=1 node --experimental-strip-types --test \
    --test-name-pattern 'H4b' test/runtime/live-life-health.test.ts
  ```
- **Severity:** major — default Model P continuum path that mock suite marks green does not work with real Pi after full idle park.
- **Suspected layer:** engine/Pi semantics + arc default (`engageMode: wake.mode ?? "continue"` in `engagement-arc.ts`). MockEngine does not enforce “continue only when last role ≠ assistant”.

### 2. inMemorySession cannot park/wake or reenter continuum — **MAJOR** (ops)

- **Symptoms:** resume path is session id, not a file → `resume path missing; inMemory session` → empty history → continue fails `No messages to continue from`; sessionRef changes.
- **Reproduction:** H6b in `live-life-health.test.ts`.
- **Severity:** major for any product path that parks with default `inMemorySession: true` and expects resume fidelity.
- **Suspected layer:** session durability / create-session resume policy (expected for inMemory; ops gap if continuum assumed).

### 3. reenter default mode is continue — same Pi failure after settled park — **MAJOR** (related)

- **Symptoms:** `Mediation.reenter` defaults `mode ?? "continue"`. Same assistant-last failure as H4b when used after parked-from-settled.
- **Workaround proven live:** `mode: "prompt"` + file session (H6).
- **Severity:** major for S8 reenter recipe defaults under real mind.
- **Suspected layer:** app/mediation reenter default + Pi continue semantics.

## Gaps not exercised

- Multi-day / wall-clock park (process restart mid-sleep).
- Multi-process worker vs client (same process worker only).
- File-backed OW sqlite + durable join reopen after process exit (mock LIFE has R12/R13; not re-run live).
- Auto-park without explicit `parkIntent` (model-driven park).
- Signal-before-wait / lost wake buffer behavior under load.
- MCP / tools / extensions under live mind (all live defs use empty tools/builtin).
- Cancel-while-parked with real Pi (mock only).
- High concurrency / cost soak.
- DeepSeek thinking-on path.

## Quality scorecard (0–5)

| Dimension | Score | Justification |
|-----------|-------|----------------|
| Cold start engage reliability | **5** | L1–L4, H1 all Settled ~0.8–1.5s with DeepSeek flash |
| Durable dispatch reliability | **5** | H2 + L4 completed+settled consistently |
| Join correlation truth | **5** | H2 join.sessionRef and planHash match result |
| Park/wake continuum | **2** | Works only with file session + `mode: "prompt"`; default continue broken live |
| Fail-closed safety | **5** | H5 CAPABILITY_RESOLVE_FAILED, no openSession, ~100ms |
| Resume/reenter fidelity | **3** | File+prompt preserves sessionRef; inMemory and default continue fail |
| Cost/latency practicality | **5** | Short prompts; full 13-test band ~15s; fail-closed free |
| Overall operational readiness | **3** | Ready for settle-only and explicit park; **not** ready for default wake/reenter continuum without ops workarounds |

## Recommendations (priority ordered)

1. **Fix default continuum for real Pi (product):** After park-from-settled (assistant last), wake/reenter should default to **prompt** (or map continue→prompt when last role is assistant). Engagement-arc `wake.mode ?? "continue"` and `Mediation.reenter` default are the live-breaking defaults. Keep H4b as regression until fixed.
2. **Ops guidance:** Continuum requires **file sessions** (`inMemorySession: false`) and, today, **explicit `mode: "prompt"`** on wake/reenter after idle park. Document in product/CLI.
3. **Keep gated suite:** `test/runtime/live-life-health.test.ts` + existing L1–L4 in `npm run test:live-pi`; do not put live in default `check`.
4. **Optional follow-up live tests:** cancel-while-parked; file OW db reopen; wake re-park (R14) with real Pi and prompt mode.
5. **Do not treat mock LIFE R2/R3 as proof of real-mind continuum** — mock misses Pi continue constraints.

## Artifacts

| Path | Role |
|------|------|
| `/Users/samanvayayagsen/project/rethink-paradigms/company/product/mediation-engine/mediation/HEALTH-REPORT-LIVE-PI.md` | This report |
| `/Users/samanvayayagsen/project/rethink-paradigms/company/product/mediation-engine/mediation/EVIDENCE-LIVE-HEALTH.md` | Compact run evidence |
| `test/runtime/live-life-health.test.ts` | New gated health scenarios H1–H7 |
| `test/pi/live-pi.test.ts` | L1 engine |
| `test/integration/live-pi-factory.test.ts` | L2 factory |
| `test/runtime/live-engagement-leaf-pi.test.ts` | L3 leaf |
| `test/runtime/live-ow-worker-pi.test.ts` | L4 worker |
| `package.json` → `test:live-pi` | Includes health suite |
| Tip SHA at investigation | `a2b6725ad5fbc87e11d84be9f9fba697798693ad` |
