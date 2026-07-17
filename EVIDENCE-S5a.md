# Evidence — Slice S5a (OpenWorkflow RuntimePort)

**Package:** `@company/mediation`  
**Branch:** `slice/S5a-ow-runtime-port`  
**Date:** 2026-07-18  
**Law:** D0 P2 (Runtime ≠ Engine), D4 RuntimePort, Gamma leaf structure  
**Depends on:** S0 (ports/types), S1 (PackResolver), S2 (PresenceFactory + mock engine)

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/openworkflow/runtime.ts` | `OpenWorkflowRuntime` — `RuntimePort` over OW client + backend |
| `src/adapters/openworkflow/types.ts` | Serializable `EngagementWorkflowInput` / `Output` + workflow names |
| `src/adapters/openworkflow/workflows/engagement.ts` | Gamma leaf: materialize → join.put → engage → outcome |
| `src/adapters/join/memory-store.ts` | In-memory `JoinStore` for tests / single-process pilots |
| `test/runtime/ow-runtime-port.test.ts` | Live OW sqlite client (no worker) + mock-client status map |
| `test/runtime/engagement-leaf.test.ts` | Leaf body + `MemoryJoinStore` with `MockEnginePort` |
| `package.json` | dependency `openworkflow@^0.9.0`; test globs for Node 26 |
| `src/index.ts` | public re-exports of S5a surface |
| `EVIDENCE-S5a.md` | this packet |

**Not landed (by design / deferred):**

| Item | Why |
|------|-----|
| Live OW **worker** registering `mediation-engagement` | Optional in contract; leaf proven without worker |
| Plan-executor migration | `runPlan` enqueues when `planSpec` set; throws if omitted |
| `adapters/pi/**` / `createAgentSession` | S2b ownership; S5a uses MockEnginePort only |
| Durable JoinStore | memory only for S5a |

---

## 2. RuntimePort map (OW client)

| RuntimePort | OpenWorkflow |
|-------------|--------------|
| `dispatch` | `ow.runWorkflow(engagementSpec, EngagementWorkflowInput, { idempotencyKey? })` |
| `runPlan` | `ow.runWorkflow(planSpec, PlanSpec, { idempotencyKey: plan.id })` — requires `planSpec` |
| `cancel` | `ow.cancelWorkflowRun(runId)` |
| `sendSignal` | `ow.sendSignal({ signal: mediation:run:{runId}:{name}, data })` |
| `getStatus` | `backend.getWorkflowRun` → map OW status → `RuntimeStatus` |
| `wait` | poll `getStatus` until terminal or timeout (`WAIT_TIMEOUT`) |

### Status mapping

| OW status | RuntimeStatus |
|-----------|---------------|
| `pending` | `{ state: "pending" }` |
| `running` | `{ state: "running" }` |
| `sleeping` | `{ state: "running", parked: true }` |
| `completed` / `succeeded` | `{ state: "completed", result }` |
| `failed` | `{ state: "failed", error }` |
| `canceled` | `{ state: "canceled" }` |
| unknown / missing | `{ state: "failed", … }` |

Dispatch input is projected to serializable engagement I/O:

```
DispatchInput { agent, task, resume?, clientRequestId? }
  → EngagementWorkflowInput { agentName, agentRoot, task, sessionRef?, requestId? }
```

Without a worker, enqueued runs stay **`pending`** — still proves client shape (submit, status, cancel, signal, wait timeout).

---

## 3. Gamma leaf (structure)

```
Input (JSON-serializable)
  → resolveDefinition (injected; no pack resolve invent inside leaf)
  → factory.materialize(definition, { resume?, cwd: agentRoot })
  → join.put({ runId, sessionRef, definitionId, packSnapshot, status: engaging })
  → presence.engage({ text: task })
  → join update / parked put
  → Output { kind, sessionRef?, packSnapshotHash?, result? | reason? | error? }
  → presence.dispose() (best-effort)
```

- **No** `resolvePacks` inside the leaf — factory owns pack path.
- **No** engine session open outside materialize (single door via injected `PresenceFactory`).
- `resolveDefinition` is injected so workers/tests supply inert defs without yaml I/O in the leaf.

### Proven with mock engine

`test/runtime/engagement-leaf.test.ts`:

1. materialize → join → engage → **settled** + 64-char `packSnapshotHash`
2. resume `sessionRef` flows through materialize
3. fail-closed missing pack → **failed** `PACK_RESOLVE_FAILED`, no join row
4. I/O survives `JSON.parse(JSON.stringify(...))`
5. `MemoryJoinStore` put / getByRunId / getBySessionRef / updateStatus

---

## 4. Mock vs live OW

| Layer | What ran | Live? |
|-------|----------|-------|
| OW client + sqlite backend | `OpenWorkflow` + `BackendSqlite.connect(":memory:")` | **yes** (in-process; no remote) |
| OW worker executing engagement workflow | not registered | **no** — runs remain pending |
| Engine (Pi) | `MockEnginePort` only | **no** live Pi |
| Leaf body | `runEngagementLeaf` direct call | unit/integration without worker |

### Future worker registration (company worker)

1. Build worker deps once: `DefaultPresenceFactory` (real Pi engine when S2b lands) + durable `JoinStore` + `resolveDefinition`.
2. Wrap `runEngagementLeaf` with OW `defineWorkflow` / register under name `mediation-engagement` (`ENGAGEMENT_WORKFLOW_NAME`).
3. Pass OW workflow run id into leaf as `deps.runId` for join correlation.
4. `OpenWorkflowRuntime` already dispatches that workflow name via `defaultEngagementWorkflowSpec()`.

Composition with future Pi factory:

```
OpenWorkflowRuntime.dispatch
  → OW worker runs engagement workflow
       → runEngagementLeaf({ factory: DefaultPresenceFactory(PiEnginePort), join, resolveDefinition })
            → materialize (Pi session) → engage → Settled | Parked | Failed
```

S5a does **not** block on that Pi factory; mock proves Gamma structure today.

---

## 5. Architectural gauges

| Gauge | Value | Gate |
|-------|-------|------|
| `layer_import_violations` | 0 | fail if ≠ 0 — domain/ports/app never import `openworkflow` |
| `second_door_count` | 0 | fail if ≠ 0 — no `createAgentSession` outside `adapters/pi` |
| `pack_parity_delta` | 0 | S1 fixture still green |

OW imports live only under `src/adapters/openworkflow/**` and `test/runtime/**`.

---

## 6. Check surface

```bash
npm run check   # typecheck && test && gauges
```

Observed:

- **typecheck:** clean
- **tests:** 29 pass (packs + presence + runtime OW + leaf + join)
- **gauges:** OK

Node note: `node --test test/` does not recurse under Node 26; scripts use `test/**/*.test.ts`.

---

## 7. Git (after S5a commit)

```
git log --oneline
# tip: S5a OpenWorkflow RuntimePort + engagement leaf (see commit message)

git status
# working tree clean (ignore untracked WORKTREE.md if present — local only)
```

Record live SHAs with `git log --oneline` and re-run `npm run check` when accepting the slice.

---

## 8. Done-when checklist

| Criterion | Status |
|-----------|--------|
| RuntimePort exists (`OpenWorkflowRuntime`) | yes |
| Leaf path proven with mock engine | yes |
| `npm run check` green | yes |
| No second door / no layer OW bleed | yes |
| No Pi adapter on this track | yes |
