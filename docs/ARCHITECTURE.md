# Architecture of the Mediation Engine

The Mediation Engine (`@rethink-paradigms/mediation`) is an **Agent Presence Monocoque** — a medium-independent substrate that turns an inert agent definition into a living Presence whose engagement ends cleanly in **Settled**, **Parked**, or **Failed**.

---

## 1. Core Principles

### The Monocoque (One Door)
Agent systems frequently fail because multiple different pathways instantiate sessions with divergent settings, uncoordinated tools, and unmanaged lifecycles.
In `@rethink-paradigms/mediation`, **all presences must materialize through one door**:
* `createLocalMediation()` (in-process composition)
* `createHostedMediation()` (durable execution via OpenWorkflow + SQLite)

No bypass doors are permitted. Architectural gauges verify this at build time (`second_door_count === 0`).

### Two Territories
The architecture strictly delineates two non-overlapping territories:
* **Domain E (The Engine)**: Vendor-specific execution mechanics (Pi SDK, Prime, LLM streams, process handles).
* **Domain A (The Agent)**: User-defined agent configuration (`agent.yaml`, system prompts, models, tool policies).
* **Domain M (Mediation)**: The neutral middle substrate that orchestrates the meeting of Domain E and Domain A without either needing to know about the other.

---

## 2. Layer Law & Import Constraints

The codebase enforces strict unidirectional dependency layers:

| Layer | Directory | May Import | Forbidden From Importing |
| :--- | :--- | :--- | :--- |
| **Domain** | `src/domain/` | Node.js stdlib only | Ports, App, Adapters, Engines |
| **Ports** | `src/ports/` | `src/domain/` + stdlib | App, Adapters, Engines |
| **App** | `src/app/` | `src/domain/`, `src/ports/` | Adapters, Engines |
| **Adapters** | `src/adapters/` | `src/ports/`, `src/domain/`, exactly ONE vendor family | Other adapter vendor families |
| **Surfaces** | `src/surfaces/` | Public `@rethink-paradigms/mediation` API only | Internal adapter implementation files |

Architectural gauges automatically measure layer imports (`layer_import_violations === 0`).

---

## 3. The Triad of Outcomes

Every engagement in the mediation engine completes with an `EngagementOutcome`:

```typescript
export type EngagementOutcome =
  | { readonly kind: "settled"; readonly sessionRef: SessionRef; readonly result?: unknown }
  | { readonly kind: "parked"; readonly sessionRef: SessionRef; readonly reason?: string; readonly whatWasAwaited?: string }
  | { readonly kind: "failed"; readonly sessionRef?: SessionRef; readonly error: MediationError };
```

1. **Settled**: The agent has completed its task successfully.
2. **Parked**: The agent has hit a pause point (awaiting human input, external webhook, or downstream job). Its cognitive state is saved to the SQLite join store, and active execution is suspended.
3. **Failed**: The agent suffered an unrecoverable failure or constraint violation.

---

## 4. Domain M & Capability Graph

Domain M exposes a comprehensive **Knowledge Face** that models capabilities, tools, and agents as nodes in an in-memory graph:

* `list(filter?)`: Search capabilities by engine, tags, or kind.
* `describe(identity)`: Inspect tools, parameters, and contracts.
* `resolve(identity)`: Resolve capability implementations.
* `validate(spec)`: Verify capability requirements against an engine.
* `compose(specs)`: Combine and merge capability definitions.
* `explain(config)`: Human/agent-readable explanation of why a capability was resolved or rejected.

---

## 5. Durable Lifecycles: OpenWorkflow + SQLite

When using `createHostedMediation`, the runtime delegates durable workflow state to `openworkflow`:
* Workflows survive host process restarts.
* The `SqliteJoinStore` records each run's status, session reference, and pack snapshot hashes.
* Waking a parked run (`hosted.wake({ runId, text })`) bridges the new user message onto the existing session tail deterministically.
