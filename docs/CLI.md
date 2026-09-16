# CLI & Daemon Control Plane Reference

The mediation engine provides a command-line interface (`mediation`) and a background HTTP/SSE daemon for interactive and durable agent operations.

---

## Commands Overview

```bash
npx mediation <command> [options]
```

### 1. `engage` (Local In-Process Engagement)
Runs an agent synchronously in the local process.

```bash
npx mediation engage --agent <dir> --task <text> [options]
```
* `--agent`: Path to agent directory containing `agent.yaml`.
* `--task`: Task description or prompt.
* `--resume <sessionRef>`: (Optional) Resume an existing session.
* `--engine <pi|prime|mock>`: Runtime engine kind (default: `mock` for CLI smoke, or set via `MEDIATION_CLI_ENGINE=pi`).
* `--no-json`: Output human-readable prose instead of raw JSON.

### 2. `dispatch` (Durable Hosted Engagement)
Submits an agent engagement to the durable runtime host.

```bash
npx mediation dispatch --agent <dir> --task <text> [--wait] [options]
```
* Returns: `runId` (unique durable identifier).
* `--wait`: Block until the run reaches a terminal state (`settled`, `parked`, or `failed`).
* `--client-request-id <id>`: Idempotency / correlation identifier.

### 3. `status`
Inspect the live status of a dispatched run.

```bash
npx mediation status --run-id <runId>
```
Output includes:
* `status`: `pending` | `running` | `completed` | `failed` | `canceled`
* `parked`: `true` | `false` (indicates whether the agent is waiting on external input)
* `sessionRef`: Associated durable session reference.

### 4. `wake`
Resume a parked run by providing the awaited response or user payload.

```bash
npx mediation wake --run-id <runId> --text <text> [options]
```
* `--text`: The user reply or webhook payload to resume execution with.
* `--mode <continue|prompt>`: (Default: `continue`) How the payload is bridged into the agent transcript.
* `--park-intent`: Force re-parking after turn execution.

### 5. `wait`
Block until a specific run finishes execution or times out.

```bash
npx mediation wait --run-id <runId> [--timeout-ms <ms>]
```

### 6. `cancel`
Cancel an active or parked execution.

```bash
npx mediation cancel --run-id <runId>
```

---

## Daemon IPC & Real-Time SSE Control Plane

For unattended, headless, or remote environments, mediation runs a daemon over a Unix domain socket or localhost HTTP port:

### Environment Variables & Flags
* `MEDIATION_IPC`: Path to Unix socket or HTTP URL (e.g. `unix:/tmp/mediation.sock` or `http://127.0.0.1:8765`).
* `--ipc <endpoint>`: Pass IPC endpoint to CLI directly.
* `--spawn`: Automatically spawn the daemon process if it is not already running.

### Real-Time Event Streaming (SSE)
The daemon exposes Server-Sent Events on `/events`:
```bash
curl -N --unix-socket /tmp/mediation.sock http://localhost/events
```
Emits real-time event frames for:
* `engagement:dispatched`
* `engagement:status`
* `engagement:parked`
* `engagement:settled`
* `engagement:failed`
