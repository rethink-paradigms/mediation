# Evidence — Live system health (Pi + DeepSeek)

**Date:** 2026-07-17T22:13Z (UTC)  
**Model:** `deepseek/deepseek-v4-flash`  
**Thinking:** `off`  
**Auth:** `~/.pi/agent/auth.json` present  
**Node:** v26.0.0  
**Tip:** `a2b6725ad5fbc87e11d84be9f9fba697798693ad`

## Command

```bash
MEDIATION_LIVE_PI=1 MEDIATION_LIVE_MODEL=deepseek/deepseek-v4-flash npm run test:live-pi
```

## Results — 13/13 pass

| Suite / ID | Result | ~ms (order of) |
|------------|--------|----------------|
| L1 engine live-pi | Settled idle | 1300 |
| L2 factory | Settled | 1500 |
| L3 leaf | Settled + join | 1500 |
| L4 OW worker | completed + Settled | 1300–2000 |
| H1 engageLocal | Settled | 1200–1500 |
| H2 hosted dispatch | Settled + join match | 1100–1600 |
| H3 parkIntent local | Parked | 800–950 |
| H4 park→wake prompt (file) | Settled same sessionRef | 2300–3000 |
| H4b default continue wake | failed ENGAGE_FAILED (asserted) | 1600–2600 |
| H5 fail-closed packs | CAPABILITY_RESOLVE_FAILED | 100 |
| H6 reenter prompt (file) | Settled same sessionRef | 1700–1900 |
| H6b inMemory continue | failed no messages (asserted) | 1100–1600 |
| H7 runPlan 2 nodes | completed both settled | 2100–2500 |

**Full band wall:** ~15.4s  
**Keyless `npm run check`:** green (live skipped)

## Product findings (runtime)

1. **Default wake continue after settled park fails on real Pi** — `Cannot continue from message role: assistant` (H4b). Workaround: `mode: "prompt"` + file session (H4).
2. **inMemory cannot continuum** — resume path missing (H6b).
3. **Fail-closed holds** without model call (H5).

Full narrative: `HEALTH-REPORT-LIVE-PI.md`.
