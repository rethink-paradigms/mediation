# Evidence — ABS-B1 (SurfacePort)

**Package:** `@company/mediation`  
**Branch:** `slice/ABS-B1-surface-port`  
**Date:** 2026-07-18  
**Law:** D5 — surfaces are connectors; this node is port + DTOs only  

---

## 1. Artifacts

| Path | Role |
|------|------|
| `src/ports/surface.ts` | `SurfacePort` + `SurfaceRequest` / engage / reenter result DTOs |
| `src/index.ts` | append-only export of SurfacePort types |
| `test/ports/surface-port.test.ts` | mock SurfacePort implementation smoke |
| `EVIDENCE-ABS-B1.md` | this packet |

**Layer rule:** `ports/surface.ts` imports only domain + `ports/runtime` (no `app/`).  
Result shapes mirror Mediation `engageLocal` / `reenter` / `dispatch` without importing app.

**Not touched:** CLI rewrite (B2), full MCP, adapters/pi, openworkflow, no merge to main.

---

## 2. Port surface

```ts
SurfaceRequest // agent, task, resume?, mode?, cwd?, clientRequestId?, channel?, park*
SurfaceEngageResult // outcome: RunOutcome + sessionRef? + packSnapshotHash? + definitionId
SurfaceReenterRequest / SurfaceReenterResult // + packSnapshotMatch

interface SurfacePort {
  engageLocal(req: SurfaceRequest): Promise<SurfaceEngageResult>;
  dispatch?(req: SurfaceRequest): Promise<DispatchHandle>;
  reenter?(req: SurfaceReenterRequest): Promise<SurfaceReenterResult>;
  getStatus?(runId: RunId): Promise<RuntimeStatus>;
}
```

---

## 3. Proofs

| Case | Result |
|------|--------|
| mock engageLocal → Settled + correlation (channel / clientRequestId) | pass |
| optional dispatch + getStatus shape | pass |
| optional reenter packSnapshot gate match / mismatch | pass |
| resume on SurfaceRequest accepted by engageLocal | pass |
| `layer_import_violations=0` | pass |
| `second_door_count=0` | pass |
| SurfacePort types on public export surface | pass (export-surface gauge) |

---

## 4. Check

```bash
npm run check
```

**Result:** exit 0  

- typecheck: clean  
- tests: 101 pass (includes ABS-B1 SurfacePort suite)  
- gauges: OK (`layer_import_violations=0`, `second_door_count=0`, `spawn_public_export_count=0`)

---

## 5. Git

```bash
git log --oneline -3
# (filled after commit)
```

**Branch only:** `slice/ABS-B1-surface-port` — no checkout/switch, no merge main.
