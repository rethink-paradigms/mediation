# Engine Adapters & Pluggable Harnesses

In `@rethink-paradigms/mediation`, the execution engine is decoupled from the agent definition and lifecycle orchestrator. All engines implement the clean, vendor-neutral `EnginePort` interface.

---

## 1. The `EnginePort` Interface

```typescript
export interface EnginePort {
  openSession(req: OpenSessionRequest): Promise<EngineSessionHandle>;
}
```

An `EngineSessionHandle` manages a single running agent session:
* `prompt(text, options?)`: Send a prompt turn to the agent.
* `steer(text)`: Inject mid-turn steering instructions.
* `followUp(text)`: Queue a follow-up turn.
* `abort()`: Abort the active turn.
* `subscribe(listener)`: Stream engine lifecycle events (tool execution, message deltas, turn completion).
* `waitForIdle()`: Await completion of all queued work.
* `dispose()`: Release resources.

---

## 2. Available Engine Substrates

### Pi Engine (`pi`)
* **Package**: `@earendil-works/pi-coding-agent`
* **Features**: Full tool calling, dynamic extensions, skills, shell execution, streaming assistant events.
* **Usage**: Default production engine. Configure via `agent.yaml` or pass `--engine pi`.

### Prime Engine (`prime`) — *Optional*
* **Package**: `prime-agent`
* **Features**: Dynamic session management, kernel integration, custom model registries.
* **Usage**: `prime-agent` is an optional peer dependency. To use it:
  ```bash
  npm install prime-agent
  ```
  Then run with `--engine prime`. If the package is not installed, the engine will fail closed with a clear, helpful error message.

### Mock Engine (`mock`)
* **Features**: Pure in-memory deterministic engine. Emulates prompt processing, tool calls, and park/settle outcomes with zero external network or process dependencies.
* **Usage**: Ideal for automated testing, CI pipelines, and quick smoke tests.

---

## 3. Writing a Custom Engine Adapter

To add support for an external framework (e.g. LangChain, AutoGen, or an in-house LLM runner):

1. Implement `EnginePort`:
```typescript
import type { EnginePort, OpenSessionRequest, EngineSessionHandle } from "@rethink-paradigms/mediation";

export class CustomEngineAdapter implements EnginePort {
  async openSession(req: OpenSessionRequest): Promise<EngineSessionHandle> {
    // 1. Initialize your custom session
    // 2. Wrap it with an EngineSessionHandle
    // 3. Return the handle
  }
}
```

2. Inject the custom adapter into mediation:
```typescript
import { createLocalMediation } from "@rethink-paradigms/mediation";

const mediation = createLocalMediation({
  engine: new CustomEngineAdapter(),
});
```
