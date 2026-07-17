# Evidence — Slice S5d (OW worker + Pi factory)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D0 Gamma + one door; S5c worker registration; S2c Pi factory  
**Depends on:** S5c `registerEngagementWorkflow`, S2c/S5b `createPiPresenceFactory`

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `test/runtime/ow-worker-pi.test.ts` | Worker + Pi factory (FakePiSession) — default check |
| `test/runtime/live-ow-worker-pi.test.ts` | Gated live worker+Pi (`MEDIATION_LIVE_PI=1`) |
| `package.json` | `test:live-pi` includes live worker+Pi |
| `EVIDENCE-S5d.md` | this packet |

**No new production module** — reuses S5c `registerEngagementWorkflow` + S2c wiring. Closes P2 dual path.

---

## 2. Path proven

```
OpenWorkflow + BackendSqlite
  → createPiPresenceFactory({ sessionFactory: FakePiSession })
  → registerEngagementWorkflow(ow, { factory, join, resolveDefinition })
  → worker.start()
  → RuntimePort.dispatch → wait → completed / Settled-shaped output
  → join.getByRunId(owRunId) settled + packSnapshotHash
```

Live: same with real Pi (`inMemorySession: true`), gated.

---

## 3. Proofs (default check)

| Case | Result |
|------|--------|
| dispatch → worker → Settled via Pi factory | pass |
| resume sessionRef | pass |
| fail-closed pack → failed leaf, no engine open | pass |

```
▶ OW worker + Pi factory (S5d, fake session)
  ✔ dispatch → worker → wait completed Settled via Pi factory
  ✔ resume sessionRef through worker + Pi factory
  ✔ fail-closed pack → completed with failed leaf (Pi not opened for packs)
```

---

## 4. Live

```bash
MEDIATION_LIVE_PI=1 npm run test:live-pi
# includes test/runtime/live-ow-worker-pi.test.ts
```

Requires Pi auth. Not required for merge.

---

## 5. P2 dual path status

| Layer | Mock mind | Pi factory (fake) | Pi live |
|-------|-----------|-------------------|---------|
| Leaf only | S5a ✓ | S5b ✓ | gated ✓ |
| Worker + RuntimePort | S5c ✓ | **S5d ✓** | gated ✓ |
| Durable join | S6 ✓ | — | — |

---

## 6. Check

`npm run check` green.  
`layer_import_violations=0` · `second_door_count=0`
