# Evidence — Slice S3 (Resume fidelity)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D0 dual durability; D1 materialize resume; packSnapshot stability  

---

## 1. Artifacts

| Path | Role |
|------|------|
| `test/integration/resume-fidelity.test.ts` | Mock + Pi-fake rematerialize proofs |
| `EVIDENCE-S3.md` | this packet |

No production API change required — factory already accepted `MaterializeOptions.resume`.

---

## 2. Proofs

| Case | Result |
|------|--------|
| Mock: resume → same sessionRef + equal planHash; second engage Settled | pass |
| Mock: join record supplies sessionRef for rematerialize | pass |
| Pi factory (FakePiSession): resume keeps sessionRef + planHash | pass |

```
▶ resume fidelity (S3, mock engine)
  ✔ rematerialize resume → same sessionRef + equal packSnapshot.planHash
  ✔ join can supply sessionRef for rematerialize
▶ resume fidelity (S3, Pi factory fake session)
  ✔ createPiPresenceFactory resume keeps sessionRef + planHash
```

---

## 3. Not in S3

| Item | Owner |
|------|--------|
| Live Pi session **file** resume across processes | later / live gated |
| Parked wake | S9 |
| CLI surface | S7 |

---

## 4. Check

`npm run check` green.
