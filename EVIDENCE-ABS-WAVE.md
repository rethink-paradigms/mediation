# Evidence — Wave ABS complete (G0 rollup)

**Date:** 2026-07-18  
**Main tip:** `443fe41` (verify `git log -1`)  
**Law:** D5 capability medium independence  
**DAG:** `research/.../slices/WAVE-ABS-DAG.md`

---

## Nodes merged (orchestrated)

| Node | Intent | Result |
|------|--------|--------|
| L0 | D5 + contracts | lead |
| A1 | Capability domain types | merged |
| B1 | SurfacePort | merged |
| C1 | createSqliteRuntimeHost | merged |
| A2 | CapabilityStore port | merged |
| A5 | root/family/agent merge | merged |
| B2 | CLI → SurfacePort | merged |
| C2 | createHostedMediation | merged |
| A3 | FsCapabilityStore | merged |
| A4 | MemoryCapabilityStore | merged |
| R1 | RegistryCapabilityStore stub | merged |
| A6 | CapabilityResolver | merged |
| A7 | Factory optional resolver | merged |
| A8 | Pi path boundary D5 L4 | merged |
| B3 | Recipes solo/reenter/dispatch/plan | merged |

---

## Abstract stack now

```
SurfacePort → Mediation / Recipes
Capability layers (root·family·agent) → CapabilityResolver
CapabilityStore: Fs | Memory | Registry(stub)
RuntimeHost: sqlite OW only (no postgres)
Pi: paths only from PackLoadPlan at adapter edge
```

---

## Check

`npm run check` green on main after final merges.  
Gauges: layer_import_violations=0, second_door_count=0, spawn_public_export_count=0.

---

## Still open (not this wave)

- Full HTTP registry client  
- Multi-file family yaml loader on disk  
- NotifyPort / wait-tool auto park  
- MCP surface adapter  
- Composite store (registry→fs) product default  
