# Evidence — Slice S8 (Reenter recipe)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D0 thin reenter recipe; packSnapshot parity; S7 façade  
**Depends on:** S3 resume, S7 Mediation, S9 Parked  

---

## 1. Artifacts

| Path | Role |
|------|------|
| `src/app/mediation.ts` | `reenter`, `reenterFromJoin` |
| `test/integration/reenter.test.ts` | cold reenter, pack gate fail, park→reenter |
| `EVIDENCE-S8.md` | this packet |

---

## 2. API

```ts
await mediation.reenter({
  agent, sessionRef, task,
  expectedPackSnapshotHash?, // fail PACK_SNAPSHOT_MISMATCH if differ
  mode?: "continue" | "prompt", // default continue
});

await mediation.reenterFromJoin(
  { runId } | { sessionRef },
  { agent, task, enforcePackSnapshot?: true, ... },
);
```

---

## 3. Proofs

| Case | Result |
|------|--------|
| engageLocal → reenter + pack gate → Settled | pass |
| wrong expected hash → failed, no false settle | pass |
| park engageLocal → reenterFromJoin continue → Settled | pass |

---

## 4. Not in S8

| Item | Owner |
|------|--------|
| SpawnEngageAdapter / dual-core kill | S11 / D3 |
| After-party TUI wiring | product surface |
| Wait-tool park detection | future |

---

## 5. Check

`npm run check` green (85 tests).
