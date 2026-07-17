# OpenWorkflow adapter — module map (SoC)

Lead holds this map. Sub-agents own **one row’s paths** only.  
Do not invent parallel materialize, pack resolve, or Pi doors.

## Responsibility matrix

| Module | Responsibility | Must not |
|--------|----------------|----------|
| `types.ts` | Serializable workflow I/O DTOs + workflow name constants | Import OW client, run Pi, touch join |
| `signals.ts` | Signal address strings + WakeSignalData parse | Import openworkflow package, call leaf |
| `runtime.ts` | RuntimePort client: dispatch/status/wait/cancel/sendSignal | materialize, engage, register workflows |
| `host.ts` | Compose BackendSqlite + OW + register* + worker + RuntimePort + join | Business park policy beyond wiring options |
| `register-engagement.ts` | **Thin** `implementWorkflow` → `runEngagementArc` | Leaf logic, signal string literals (use signals.ts) |
| `register-plan.ts` | Plan workflow registration | Engagement park continuum (later reuse leaf/arc) |
| `workflows/engagement.ts` | **Pure Gamma leaf**: materialize → join → engage → dispose | `waitForSignal`, OW client, multi-step loops |
| `workflows/engagement-arc.ts` | **Durable arc**: step.run / waitForSignal / continue leaf | openSession, CapabilityResolver, pack search |
| `workflows/plan.ts` | Sequential plan nodes → leaf | Park Model P (prove on engagement first) |

## Dependency direction (adapters/openworkflow)

```text
host.ts
  → register-engagement / register-plan / runtime / join
register-engagement.ts
  → engagement-arc.ts → engagement.ts (leaf)
  → types.ts, runtime (spec helper only)
runtime.ts
  → types.ts, signals.ts, ports/runtime
engagement-arc.ts
  → engagement.ts, types.ts, signals.ts (P1+)
engagement.ts
  → domain + ports only (factory, join) via deps inject
```

**Never:** `engagement.ts` → openworkflow vendor.  
**Never:** `runtime.ts` → factory / leaf.  
**Never:** domain/app → openworkflow.

## LIFE phase ownership (locked Model P, P1–P3)

| Slice | Exclusive paths | Behavior |
|-------|-----------------|----------|
| **Scaffold** (this commit) | signals.ts, engagement-arc.ts, thin register, types input fields, runtime uses signals | Behavior parity: still complete-on-park |
| **LIFE-P1** | `workflows/engagement-arc.ts` (+ tests). May touch `signals.ts` if names wrong. | Parked → waitForSignal; status not completed |
| **LIFE-P2** | `engagement-arc.ts`, maybe `engagement.ts` input mapping only | Wake → resume leaf continue |
| **LIFE-P3** | `app/mediation.ts`, `app/recipes/wake.ts`, surface optional, index exports | cancel/sendSignal/wake façade |

## Leaf vs arc (one sentence each)

- **Leaf:** one disposable Pi life slice for one task/continue payload.  
- **Arc:** how many leaf slices and waits make up one OW `runId` under Model P.

## Tests

| Kind | Location |
|------|----------|
| Leaf pure (no OW) | `test/runtime/engagement-leaf*.ts` |
| Arc / worker continuum | `test/runtime/ow-worker-*.ts`, future `test/runtime/engagement-arc*.ts` |
| RuntimePort client | `test/runtime/ow-runtime-port.test.ts` |
| Hosted compose | `test/runtime/host-mediation.test.ts` |
| Façade control (P3) | `test/surfaces/` or `test/app/` |

## Review reject list

- Second `createAgentSession` outside `adapters/pi/`  
- Factory PackResolver fork  
- `waitForSignal` inside `runEngagementLeaf`  
- Hardcoded signal strings outside `signals.ts`  
- Plan workflow “special” park before engagement arc proven  
- CLI/MCP sequencing logic (surfaces map only)
