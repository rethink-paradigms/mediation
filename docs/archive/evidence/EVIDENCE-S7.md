# Evidence — Slice S7 (Mediation façade + CLI)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D4 surfaces → façade → ports; no second monocoque  

---

## 1. Artifacts

| Path | Role |
|------|------|
| `src/app/mediation.ts` | `Mediation` façade (load / materialize / engageLocal / dispatch / join) |
| `src/adapters/compose.ts` | `createLocalMediation` (mock default, optional Pi) |
| `src/surfaces/cli.ts` | thin CLI `engage` |
| `package.json` | scripts `mediation` / `cli` |
| `test/surfaces/mediation-facade.test.ts` | façade + CLI smoke |
| `EVIDENCE-S7.md` | this packet |

---

## 2. Usage

```bash
npm run mediation -- engage --agent <agentDir> --task "hello"
npm run mediation -- engage --agent <agentDir> --task "hello" --project-root <packsRoot>
npm run mediation -- engage --agent <agentDir> --task "cont" --resume <sessionRef>
```

Default mind: **mock engine** (no keys). `MEDIATION_CLI_PI=1` → Pi factory compose.

---

## 3. Proofs

| Case | Result |
|------|--------|
| engageLocal Settled + resume sessionRef | pass |
| yaml load via createLocalMediation | pass |
| dispatch without runtime throws | pass |
| CLI parseArgs / help | pass |
| runCli engage mock → exit 0 | pass |

---

## 4. Not in S7

| Item | Owner |
|------|--------|
| Full dispatch CLI (OW worker start) | later |
| Parked UX | S9 |
| After-party reenter recipe | S8 |

---

## 5. Layers

`app/mediation.ts` imports only domain + ports.  
`layer_import_violations=0`.

---

## 6. Check

`npm run check` green.
