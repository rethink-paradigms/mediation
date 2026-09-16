# Contributing to Mediation Engine

Thank you for your interest in contributing to `@rethink-paradigms/mediation`!

## Architectural Principles

The Mediation Engine is an **Agent Presence Monocoque** designed with strict structural invariants:
1. **One Door**: All agent presences are materialized through a single entry point (`createLocalMediation` or `createHostedMediation`).
2. **Two Territories**: Engine execution (Domain E) and Agent definitions (Domain A) never leak into one another. Mediation (Domain M) is the neutral substrate between them.
3. **Pluggable Engines**: Engines are isolated behind the `EnginePort` interface. Core dependencies remain minimal; optional harnesses (like `prime-agent`) are lazy-loaded without forcing unnecessary runtime dependencies.
4. **Medium-Independent Capabilities**: Capabilities are addressed strictly by identity, never by arbitrary file paths.

## Prerequisites

- **Node.js**: Version `>= 22` (uses native `--experimental-strip-types`)
- **npm**: Version `>= 10`

## Development Workflow

1. **Clone the repository**:
   ```bash
   git clone https://github.com/rethink-paradigms/mediation.git
   cd mediation
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the Compiler & Quality Gate**:
   `npm run check` is the canonical gate. It runs:
   - TypeScript typechecking (`tsgo --noEmit`)
   - Linter (`oxlint`)
   - Test suite (`node --test`)
   - Architectural gauges (`scripts/gauges/run.ts`)

   ```bash
   npm run check
   ```

   > **Rule**: Every commit and pull request must have a green `npm run check`. If any gauge fails (`layer_import_violations !== 0`, `second_door_count !== 0`), the build fails.

4. **Running Tests Individually**:
   ```bash
   npm test               # Run unit & runtime tests
   npm run typecheck      # Typecheck without emit
   npm run lint           # Run linter
   npm run gauges         # Measure architectural gauges
   ```

5. **Submitting Changes**:
   - Create a feature or fix branch (`git checkout -b feature/your-feature`).
   - Ensure `npm run check` passes with zero warnings or failures.
   - Open a pull request against `main`.
