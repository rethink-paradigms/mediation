# @company/mediation

Sole **Agent Presence** monocoque for the company platform.

- **Law:** research `agent-configuration-knowledge-model` D0–D4  
- **Structure:** `understanding/software-architecture.md`  
- **Method:** slices under research `slices/S*.md`

## Agent feedback (compiler)

`npm run check` is the **compiler surface** for this package: typecheck + tests + architectural gauges. Non-zero exit = stop and fix. Details: [`TOOLING.md`](./TOOLING.md), agent git/workflow: [`AGENTS.md`](./AGENTS.md).

```bash
npm run check
```

## Import rules

| Layer | May import |
|-------|------------|
| `src/domain` | stdlib only |
| `src/ports` | domain only |
| `src/app` | domain + ports only |
| `src/adapters/*` | ports + domain + **one** vendor family |
| Surfaces | public `@company/mediation` only |

**Forbidden:** second public session factory; `createAgentSession` outside `adapters/pi`.

## Scripts

```bash
npm run check       # typecheck && test && gauges (use this)
npm run typecheck
npm run test
npm run gauges      # hard-fail on layer / second-door violations
```

## Slices

| Slice | Status |
|-------|--------|
| S0 package + domain + ports | **accepted** |
| S1 PackResolver + goldens | **accepted** |
| S2 factory + engage Settled (mock) | **accepted** |
| S0g git baseline + fail-fast toolchain | **accepted** |
| S2b PiEngineAdapter | ahead |
| S3–S4 resume / reenter | ahead |
