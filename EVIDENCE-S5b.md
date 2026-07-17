# Evidence — Slice S5b (Engagement leaf + Pi factory)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D0 Gamma leaf + one door; S2c factory composition  
**Depends on:** S5a leaf, S2c `createPiPresenceFactory`, S2b Pi adapter

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `test/runtime/engagement-leaf-pi.test.ts` | Leaf + Pi factory (FakePiSession) — default check |
| `test/runtime/live-engagement-leaf-pi.test.ts` | Gated live leaf (`MEDIATION_LIVE_PI=1`) |
| `package.json` | `test:live-pi` includes live leaf test |
| `EVIDENCE-S5b.md` | this packet |

**No production code change required** — leaf already injects `PresenceFactory`; S5b proves dual-path unit with real Pi composition.

---

## 2. Proofs (default check)

| Case | Result |
|------|--------|
| leaf + createPiPresenceFactory + FakePiSession → Settled | pass |
| join row settled + packSnapshotHash parity | pass |
| resume sessionRef through leaf | pass |
| fail-closed pack → failed, no openSession | pass |

```
▶ engagement leaf + Pi factory (S5b, fake session)
  ✔ materialize → join → engage → settled via createPiPresenceFactory
  ✔ resume sessionRef flows through leaf + Pi factory
  ✔ fail-closed pack resolve → failed; no engine open
```

---

## 3. Live

Gated; not required for merge / default check.

```bash
MEDIATION_LIVE_PI=1 MEDIATION_LIVE_MODEL=deepseek/deepseek-v4-flash npm run test:live-pi
# includes test/runtime/live-engagement-leaf-pi.test.ts
# definition thinking: off
```

### Transcript (2026-07-18, deepseek/deepseek-v4-flash, thinking:off)

```
[live-leaf-pi] INFO Model resolved { provider: 'deepseek', modelId: 'deepseek-v4-flash' }
[live-leaf-pi] INFO AgentSession created { sessionRef: '019f71a3-eb9e-7888-b42d-cdd6592b7a1b' }
[live-leaf-pi] output= {
  "kind": "settled",
  "sessionRef": "019f71a3-eb9e-7888-b42d-cdd6592b7a1b",
  "packSnapshotHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
✔ runEngagementLeaf → Settled with real Pi factory (~1797ms)
```

**blocked_reason:** none.

---

## 4. Not in S5b

| Item | Owner |
|------|--------|
| OW worker executes leaf | S5c |
| Worker + live Pi | S5d |
| Durable JoinStore | S6 |

---

## 5. Check

`npm run check` green (typecheck + test + gauges).  
`layer_import_violations=0` · `second_door_count=0`
