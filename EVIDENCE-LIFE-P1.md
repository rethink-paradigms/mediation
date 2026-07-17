# Evidence — LIFE-P1 Parked ⇒ OW wait (Model P)

**Date:** 2026-07-18  
**Branch:** `slice/LIFE-P1-park-wait`  
**Contract:** research `slices/LIFE-P1-park-wait-contract.md`  
**Law:** D0–D2 · leaf pure · arc owns wait  

---

## What landed

### `runEngagementArc` (Model P)

After first leaf returns `kind: "parked"`:

1. Require `step.waitForSignal` (else fail-closed `PARK_WAIT_UNAVAILABLE`)
2. `waitForSignal({ name: "engagement-wake", signal: engagementWakeSignal(runId) })`
3. On delivery: return **parked** outcome as **P1 interim** terminal (P2 continues on Pi)

Settled / Failed still complete immediately (no wait).

### Dispatch wiring

- `DispatchInput.parkIntent` / `parkReason` → `toEngagementInput` → leaf engage stand-in

### Structure preserved

- No `waitForSignal` in `runEngagementLeaf`
- Signal addresses only via `signals.ts`
- `register-engagement.ts` remains thin → arc

---

## Proof

| Test | Assertion |
|------|-----------|
| Arc unit settled | no waitForSignal call |
| Arc unit park | wait signal = `mediation:run:{id}:wake`; join parked |
| Arc unit no wait API | `PARK_WAIT_UNAVAILABLE` |
| OW worker park | join parked + status ≠ completed until wake; after wake completed with `kind: parked` |
| Prior S5c settled/resume/fail-closed | regression green |

```bash
cd company/platform/mediation
npm run check
```

**Tip:** record after merge (`git log -1`).

---

## Interim product note

P1 proves **orchestration wait**. After wake, workflow still returns parked without a second Pi continue — **LIFE-P2** rematerialize + engage continue.

---

## Non-goals (held)

- Pi continue after wake (P2)  
- Mediation cancel/wake façade (P3)  
- CLI / MCP  
- Auto wait-tool park detection  
