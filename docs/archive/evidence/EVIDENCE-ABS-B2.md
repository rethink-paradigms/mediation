# Evidence — ABS-B2 (CLI as SurfacePort adapter)

**Package:** `@company/mediation`  
**Branch:** `slice/ABS-B2-cli-surface`  
**Date:** 2026-07-18  
**Law:** D5 — surfaces are connectors; CLI talks SurfacePort only  

---

## 1. Artifacts

| Path | Role |
|------|------|
| `src/adapters/surface/mediation-surface.ts` | `createMediationSurface(mediation): SurfacePort` (+ `MediationSurface` alias) |
| `src/surfaces/cli.ts` | refactor: compose edge → SurfacePort; engage via `surface.engageLocal` only |
| `src/index.ts` | append-only export of `createMediationSurface` / `MediationSurface` |
| `test/surfaces/mediation-facade.test.ts` | CLI smoke + MediationSurface wrap + injected SurfacePort |
| `EVIDENCE-ABS-B2.md` | this packet |

**Layer:** adapter wraps Mediation; CLI never calls factory / Presence.  
`channel: "cli"` set on SurfaceRequest. Optional `runCli(..., { surface })` for injection.

**Not touched:** MCP server, domain capability, openworkflow host rewrite, no merge to main.

---

## 2. Surface adapter

```ts
createMediationSurface(mediation: Mediation): SurfacePort
// engageLocal / dispatch / reenter / getStatus map Surface* DTOs → Mediation
```

CLI edge:

```ts
const surface = createMediationSurface(createLocalMediation(...).mediation);
await surface.engageLocal({ agent, task, resume?, cwd, channel: "cli" });
```

---

## 3. Proofs

| Case | Result |
|------|--------|
| createMediationSurface wraps engageLocal → Settled | pass |
| runCli engage mock mind → exit 0 (existing smoke) | pass |
| runCli injected SurfacePort without compose | pass |
| parseArgs / help / missing args → 2 | pass |
| `layer_import_violations=0` | pass |
| `second_door_count=0` | pass |
| `createMediationSurface` / `MediationSurface` on public export surface | pass |

---

## 4. Check

```bash
npm run check
```

**Result:** exit 0  

- typecheck: clean  
- tests: 109 pass (includes ABS-B2 createMediationSurface suite + CLI engage smoke)  
- gauges: OK (`layer_import_violations=0`, `second_door_count=0`, `spawn_public_export_count=0`)

---

## 5. Git

```text
6e416cf ABS-B2: wrap Mediation as SurfacePort; CLI uses SurfacePort only.
22bb56d Merge branch 'slice/ABS-C1-runtime-host'.
79f4a20 Merge branch 'slice/ABS-B1-surface-port'.
```

**Tip:** `6e416cf14ac442c830f6f26b3540fe5d69edf7b8`  
**Branch only:** `slice/ABS-B2-cli-surface` — no checkout/switch, no merge main.
