# Evidence — PRODUCT-1 Durable pilot vertical

**Date:** 2026-07-18  
**Branch:** `slice/PRODUCT-1-durable-pilot`  
**Altitude:** product path on held monocoque (not redesign)  
**Contract:** research `slices/PRODUCT-1-durable-pilot-contract.md`

---

## What landed

### Product join policy (`createHostedMediation`)

When `join` is omitted:

| `dbPath` | Default join |
|----------|----------------|
| `:memory:` | `MemoryJoinStore` |
| filesystem path | owned `SqliteJoinStore` at `joinPath` or `<dirname(dbPath)>/mediation-join.sqlite` |

- `joinPath?: string` on `CreateHostedMediationOptions`
- Owned sqlite join closed on `stop()`; injected join never closed by compose
- Helpers exported: `resolveHostedJoin`, `defaultHostedJoinPath`

### Pilot proof (keyless default check)

| Proof | How |
|-------|-----|
| File-backed hosted join is durable | dispatch → wait settled → stop → reopen SqliteJoinStore → same runId/sessionRef/planHash |
| Policy unit | memory vs file vs inject vs joinPath override |
| Real agent (optional) | `company/agents/coding-agent` load + CapabilityResolver ok + engageLocal mock Settled when tree present |

No live LLM. No monocoque dual-path. CapabilityResolver remains sole materialize path.

---

## Verify

```bash
cd company/platform/mediation
git log -1
npm run check
```

**Tip after merge:** `f4868cd` (merge of `4a36ca8` PRODUCT-1 onto main).

**Expected:** typecheck + tests + gauges OK.  
**Tests:** 182 pass (was 174 pre-PRODUCT-1; +8 product suite).

---

## Non-goals (still open)

- Multi-process OW worker daemon  
- CLI dispatch / hosted surface command  
- Live Pi engage for coding-agent  
- Company `_harness` dual-core death  
- NotifyPort / MCP / composite registry store  

---

## Next product steps (suggested)

1. CLI `dispatch` + file db flags through `createHostedMediation`  
2. Live opt-in pilot: `MEDIATION_LIVE_PI=1` coding-agent engageLocal  
3. File session resume fidelity for real Pi sessions  
4. Only then external dual-core cutover  
