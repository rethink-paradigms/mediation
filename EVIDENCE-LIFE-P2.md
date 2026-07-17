# Evidence — LIFE-P2 Wake → continue on Pi (same runId)

**Date:** 2026-07-18  
**Branch:** `slice/LIFE-P2-wake-continue`  
**Contract:** research `slices/LIFE-P2-wake-continue-contract.md`  
**Depends:** LIFE-P1 Model P wait  

---

## What landed

### `runEngagementArc` continuum

```text
leaf (may Parked)
  → waitForSignal(engagementWakeSignal)
  → parseWakeSignalData
  → leaf continue: sessionRef + payloadText + engageMode continue
  → Settled | Failed | Parked (loop, max 32)
```

- Unique step names: `engagement-wake-N`, `engagement-continue-N`
- Wake optional `parkIntent` for explicit re-park
- Leaf remains pure Gamma; no OW wait inside leaf

### Signals

`WakeSignalData` may carry `parkIntent` / `parkReason` for control-plane re-park.

---

## Proof

| Test | Result |
|------|--------|
| Arc park → wake → Settled same sessionRef | pass |
| Arc re-park once then settle | pass |
| Worker park → wake continue → Settled + join settled | pass |
| Settled / fail-closed regressions | pass |

```bash
cd company/platform/mediation && npm run check
```

**Tip after merge:** `3f6b229`.

---

## Next

LIFE-P3 — Mediation cancel / sendSignal / wake façade (no CLI yet).
