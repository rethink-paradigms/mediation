# Evidence — Slice S2c (Pi + PresenceFactory live integration)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/S2c-pi-factory-live`  
**Law:** D0 one door, S2b PiEngineAdapter, live factory → Settled  
**Depends on:** S2 factory/presence, S2b PiEngineAdapter, S1 packs

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/wiring.ts` | `createPiPresenceFactory` — Pi + PackResolver + DefaultPresenceFactory |
| `test/integration/pi-factory.test.ts` | Unit path: factory + fake Pi → Settled / resume / fail-closed |
| `test/integration/live-pi-factory.test.ts` | Live gated `MEDIATION_LIVE_PI=1`: materialize → engage → Settled |
| `package.json` | `test:live-pi` includes factory live suite |
| `EVIDENCE-S2c.md` | this packet |

**Not landed (other ownership):** YamlDefinitionLoader (S1b), openworkflow changes.

**Public package (`src/index.ts`):** does **not** re-export `createPiPresenceFactory` / Pi (composition import `src/adapters/wiring.ts`). Comment-only index note for S2c.

### Composition

```ts
import { createPiPresenceFactory } from "./adapters/wiring.ts";

const { factory, engine } = createPiPresenceFactory({
  inMemorySession: true,
  // unit path: sessionFactory: async () => ({ session: fake, sessionRefValue })
});
const presence = await factory.materialize(definition);
const outcome = await presence.engage({ text: "hello" });
// outcome.kind === "settled"
```

Sequence:

```
createPiPresenceFactory
  → PiEngineAdapter + createPackResolver + toPackSnapshot
  → DefaultPresenceFactory.materialize
       packs → openSession (sole createAgentSession under adapters/pi)
  → presence.engage → waitUntilIdle → evaluateSettled → Settled
```

---

## 2. Test inventory

| Kind | File | What it proves |
|------|------|----------------|
| Integration (fake) | `test/integration/pi-factory.test.ts` | composition helper materialize + engage Settled; resume sessionRef; pack fail-closed |
| Live factory | `test/integration/live-pi-factory.test.ts` | real Pi via factory → Settled + sessionRef |
| Live engine (S2b, still) | `test/pi/live-pi.test.ts` | openSession + prompt + waitUntilIdle |
| Mock path (S2, unchanged) | `test/presence/engage-settled.test.ts` | MockEnginePort still green |

Live suites **skip** unless `MEDIATION_LIVE_PI=1` so default `npm run check` needs no keys.

Optional resume **live** deferred (inMemory sessionRef is not a resume file path); resume proven on unit path via composition helper.

---

## 3. Live observation

### Command

```bash
MEDIATION_LIVE_PI=1 node --experimental-strip-types --test \
  test/integration/live-pi-factory.test.ts test/pi/live-pi.test.ts
# or: npm run test:live-pi
```

Optional model: `MEDIATION_LIVE_MODEL=provider/model-id`  
**Default live model:** `deepseek/deepseek-v4-flash` with `thinking: off`.  
Requires host auth at `~/.pi/agent/auth.json`.

### transcript (2026-07-18, deepseek/deepseek-v4-flash, thinking:off)

```
[live-pi-factory] INFO Model resolved { provider: 'deepseek', modelId: 'deepseek-v4-flash' }
[live-pi-factory] INFO ResourceLoader ready { extensions: 0 }
[live-pi-factory] INFO AgentSession created { sessionRef: '019f71a3-eb9e-71cc-8432-9d7a728c7b88' }
[live-pi-factory] sessionRef= 019f71a3-eb9e-71cc-8432-9d7a728c7b88
[live-pi-factory] outcome= { kind: 'settled', sessionRef: '019f71a3-eb9e-71cc-8432-9d7a728c7b88' } trail= … idle,status:idle
[live-pi-factory] disposed ok
✔ createPiPresenceFactory materialize + engage → Settled (~1805ms)

[live-pi] INFO Model resolved { provider: 'deepseek', modelId: 'deepseek-v4-flash' }
[live-pi] sessionRef= 019f71a3-eba4-7733-a74e-e02d412f62b0
[live-pi] idle= { reason: 'agent_settled' } …
✔ openSession + prompt + waitUntilIdle + dispose (~1787ms)
```

**blocked_reason:** none.

Human re-run if auth missing: install Pi credentials, then the command above.

---

## 4. Gauges + check + git

| Gauge | Expected | Observed |
|-------|----------|----------|
| `layer_import_violations` | 0 | **0** |
| `second_door_count` | 0 outside `src/adapters/pi/**` | **0** |
| `npm run check` (no live flag) | green | **green** (45 tests pass; live suites skipped) |

```
npm run check
# typecheck OK
# tests: 45 pass (live skipped)
# gauges: OK — layer_import_violations=0 second_door_count=0
```

### git

```
343b09d S2c: record evidence git log tip and check surface.
53998c8 S2c: createPiPresenceFactory wires PiEngineAdapter to Settled.
7a47e1c Fix second_door gauge false positive on comments after merge.
681be9b Merge branch 'slice/S5a-ow-runtime-port'.
429901b Merge branch 'slice/S2b-pi-engine-adapter'.

npm run check  # typecheck + 45 tests + gauges OK (post-commit)
```

Branch: `slice/S2c-pi-factory-live` only (worktree `mediation-wt-s2c`).

---

## Done criteria (self-check)

- [x] `createPiPresenceFactory` composition helper (Pi + packs + factory)
- [x] Integration tests with injectable / fake session for default check
- [x] Live gated factory.materialize → engage → Settled + sessionRef
- [x] `npm run check` green without live flag
- [x] Evidence with live transcript (or blocked_reason)
- [x] No Yaml loader, no openworkflow edits, one door
