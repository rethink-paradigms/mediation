# Evidence — Slice S6 (Durable JoinStore)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D0 P4 dual durability; D4 JoinStore  
**Depends on:** S0 port + EngagementRecord; S5a MemoryJoinStore kept

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/join/sqlite-store.ts` | `SqliteJoinStore` via `node:sqlite` DatabaseSync |
| `test/runtime/sqlite-join-store.test.ts` | in-memory + file reopen durability |
| `src/index.ts` | public export `SqliteJoinStore` / options |
| `EVIDENCE-S6.md` | this packet |

---

## 2. Design notes

- **Engine:** Node built-in `node:sqlite` (no better-sqlite3 native dep).
- **Schema:** `engagement_join` PK `run_id`, UNIQUE `session_ref`, JSON pack_snapshot + optional parked.
- **MemoryJoinStore** unchanged for pure unit tests / S5a leaf path.
- Leaf may inject either store; S5b still uses Memory for default leaf tests.

---

## 3. Proofs

| Case | Result |
|------|--------|
| put / get / updateStatus (`:memory:`) | pass |
| put → close → reopen file path → get | pass |
| parked JSON round-trip | pass |
| updateStatus missing → throw | pass |
| session unique moves on re-put | pass |

```
▶ SqliteJoinStore
  ✔ put / get / updateStatus in memory
  ✔ survives close + reopen on file path
  ✔ updateStatus on missing run throws
  ✔ re-put same runId overwrites; session unique moves
```

---

## 4. Not in S6

| Item | Owner |
|------|--------|
| Mediation façade wiring join into product API | later |
| OW backend schema merge | out of scope — product join ≠ OW tables |
| Leaf default switch to sqlite | optional; inject when durable needed |

---

## 5. Check

`npm run check` green.  
`layer_import_violations=0` · `second_door_count=0`
