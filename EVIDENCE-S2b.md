# Evidence — Slice S2b (PiEngineAdapter, real engine unit)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/S2b-pi-engine-adapter`  
**Law:** D0–D1, D4 EnginePort, S0g fail-fast, agentic method  
**Depends on:** S0 ports, S1 packs, S2 factory/presence (mock remains for unit path)

---

## 1. Adapter file map

| Path | Role |
|------|------|
| `src/adapters/pi/engine-adapter.ts` | `PiEngineAdapter` implements `EnginePort` |
| `src/adapters/pi/create-session.ts` | **Sole door:** `createAgentSession` + `ModelRuntime` + resource loader |
| `src/adapters/pi/session-handle.ts` | `PiEngineSessionHandle` → `EngineSessionHandle` |
| `src/adapters/pi/event-map.ts` | Pi session events → `EngineEvent` / idle |
| `src/adapters/pi/types.ts` | Internal `PiSessionSurface` / factory types |
| `src/adapters/pi/index.ts` | Adapter package surface (not public package door) |
| `test/pi/event-map.test.ts` | Unit: event mapping |
| `test/pi/fake-session.ts` | Thin fake of Pi session surface (adapter tests only) |
| `test/pi/engine-adapter.test.ts` | Unit of adapter + factory engage Settled via fake Pi |
| `test/pi/live-pi.test.ts` | Live opt-in (`MEDIATION_LIVE_PI=1`) |
| `EVIDENCE-S2b.md` | this packet |

**Dependency:** `@earendil-works/pi-coding-agent` `^0.80.10` (align ~0.80 with afterparty).

**Public package (`src/index.ts`):** does **not** re-export `PiEngineAdapter` (architecture: no second product door). Composition imports `src/adapters/pi/*` or `src/adapters/pi/index.ts`.

### Wiring sketch (factory uses Pi vs Mock)

```ts
import { PiEngineAdapter } from "./adapters/pi/engine-adapter.ts";
// or: import { MockEnginePort } from "./adapters/mock/engine-adapter.ts";
import { DefaultPresenceFactory } from "./app/factory.ts";
import { createPackResolver, toPackSnapshot } from "./index.ts";

const engine = new PiEngineAdapter({ inMemorySession: true });
const factory = new DefaultPresenceFactory({
  engine,
  packResolver: createPackResolver(),
  toPackSnapshot,
});
```

---

## 2. How waitUntilIdle is decided

| Mechanism | Role |
|-----------|------|
| **Primary settle signal** | Pi `agent_settled` session event → `EngineEvent` `{ type: "idle", reason: "agent_settled" }` |
| **Wait primitive** | `session.waitForIdle()` (Pi 0.80+) inside handle; falls back to `agent.waitForIdle` |
| **Not idle** | `agent_end` with `willRetry: true` (raw only) |
| **Default agent_end** | `willRetry: false` → raw only (prefer `agent_settled`, per blueprint) |
| **Abort** | `session.abort()` then idle `reason: "aborted"` if still busy |
| **Open** | handle starts idle with `reason: "session_open"` |

Documented mapping lives in `event-map.ts` header + this section.

---

## 3. Test inventory

| Kind | File | What it proves |
|------|------|----------------|
| Unit (map) | `test/pi/event-map.test.ts` | agent_settled → idle; agent_end policy; tools/messages |
| Unit (adapter) | `test/pi/engine-adapter.test.ts` | openSession/sessionRef; prompt→idle; continue; interrupt; factory Settled; AbortSignal |
| Live | `test/pi/live-pi.test.ts` | real `createAgentSession` open + prompt + waitUntilIdle + dispose |
| Mock path (S2, unchanged) | `test/presence/engage-settled.test.ts` | factory still works with `MockEnginePort` |

Live is **skipped** unless `MEDIATION_LIVE_PI=1` so default `npm run check` stays reliable without keys.

---

## 4. Live observation

### Command

```bash
MEDIATION_LIVE_PI=1 node --experimental-strip-types --test test/pi/live-pi.test.ts
```

Optional model override: `MEDIATION_LIVE_MODEL=provider/model-id` (default anthropic haiku probe).

Requires host auth at `~/.pi/agent/auth.json` (ModelRuntime default).

### Transcript (agent run, 2026-07-18)

```
[live-pi] INFO Model resolved { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' }
[live-pi] INFO ResourceLoader ready { extensions: 0 }
[live-pi] INFO AgentSession created { sessionRef: '019f717d-68b0-7339-b131-1c174c183e7a' }
[live-pi] sessionRef= 019f717d-68b0-7339-b131-1c174c183e7a
[live-pi] idle= { at: '2026-07-17T19:11:12.583Z', reason: 'agent_settled' } trail= msg:user,raw:agent_start,raw:turn_start,raw:message_start,msg:user,raw:message_start,msg:assistant,raw:turn_end,raw:agent_end,idle:agent_settled
[live-pi] disposed ok
✔ openSession + prompt + waitUntilIdle + dispose via real createAgentSession (1097ms)
```

**blocked_reason:** none (live succeeded in this environment).

Human re-run if auth missing: install Pi credentials, then the command above.

---

## 5. Gauges + check + git

| Gauge | Expected | Observed |
|-------|----------|----------|
| `layer_import_violations` | 0 | **0** |
| `second_door_count` | 0 outside `src/adapters/pi/**` | **0** |
| `npm run check` (no live flag) | green | **green** (27 tests pass; live suite skipped) |

```
npm run check
# typecheck OK
# tests: 27 pass (live skipped)
# gauges: OK — layer_import_violations=0 second_door_count=0
```

### git

```
37dff32 S2b: PiEngineAdapter with real createAgentSession under adapters/pi.
5c034af S0g: stabilize evidence packet git log wording.
dcd217b S0g: refresh evidence git log SHAs after evidence commit.
994e22e S0g: evidence packet for git baseline and fail-fast check surface.
3503096 S0g: git baseline and fail-fast toolchain over accepted S0–S2.

npm run check  # typecheck + 27 tests + gauges OK (post-commit)
```

Branch: `slice/S2b-pi-engine-adapter` only (worktree `mediation-wt-s2b`).

---

## Done criteria (self-check)

- [x] `PiEngineAdapter` implements `EnginePort`
- [x] Pi actually invoked on live path (`createAgentSession` under adapters/pi only)
- [x] Unit tests without substituting MockEnginePort for S2b proof
- [x] Live gated + transcript in evidence
- [x] `npm run check` green without live flag
- [x] One door; domain/app do not import Pi
