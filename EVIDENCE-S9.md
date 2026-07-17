# Evidence — Slice S9 (Parked path)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D1 RunOutcome Parked; status parked  

---

## 1. Artifacts

| Path | Role |
|------|------|
| `src/domain/presence.ts` | `EngageInput.parkIntent` / `parkReason` |
| `src/app/presence.ts` | engage → parked status + resumeToken |
| `test/presence/engage-parked.test.ts` | park, continue after park, leaf join parked |
| `EVIDENCE-S9.md` | this packet |

Wait-tool auto-detect deferred; recipes/tests pass `parkIntent: true`.

---

## 2. Proofs

| Case | Result |
|------|--------|
| parkIntent → kind parked + status parked + resumeToken | pass |
| park → dispose → rematerialize resume → continue Settled | pass |
| leaf → join status parked + parked fields | pass |

---

## 3. Continuum

```
engage(parkIntent) → Parked → dispose OK
  → materialize(resume) → engage(continue) → Settled
```

Not OS thaw. Context-array continue (D1).

---

## 4. Check

`npm run check` green.
