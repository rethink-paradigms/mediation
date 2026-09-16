# Evidence — Live Pi band (full dual path)

**Date:** 2026-07-18  
**Model (exact):** `deepseek/deepseek-v4-flash`  
**Thinking:** `off`  
**Auth:** `~/.pi/agent/auth.json` present  
**Command:**

```bash
MEDIATION_LIVE_PI=1 MEDIATION_LIVE_MODEL=deepseek/deepseek-v4-flash npm run test:live-pi
```

(Default live model in harness is now also `deepseek/deepseek-v4-flash`.)

---

## Results — 4/4 pass

| Suite | Result | sessionRef (sample) | ~ms |
|-------|--------|---------------------|-----|
| Engine live (`test/pi/live-pi.test.ts`) | Settled idle | `019f71a3-eba4-7733-a74e-e02d412f62b0` | 1787 |
| Factory live (`test/integration/live-pi-factory.test.ts`) | Settled | `019f71a3-eb9e-71cc-8432-9d7a728c7b88` | 1805 |
| Leaf live (`test/runtime/live-engagement-leaf-pi.test.ts`) | Settled + pack hash | `019f71a3-eb9e-7888-b42d-cdd6592b7a1b` | 1797 |
| Worker live (`test/runtime/live-ow-worker-pi.test.ts`) | OW completed + Settled | `019f71a3-ebb0-7815-a1d9-b487f70298dc` | 1813 |

**Total wall:** ~3.4s for full band.  
**blocked_reason:** none.

---

## Interpretation

Real DeepSeek V4 Flash path holds for:

1. one-door `createAgentSession`  
2. factory monocoque engage  
3. Gamma leaf  
4. OW worker + RuntimePort dispatch → wait → completed  

Default `npm run check` still **skips** live (no keys required for CI wall).
