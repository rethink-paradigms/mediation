/**
 * DefaultAgentPresence — status machine over EngineSessionHandle (D1).
 * App layer: domain + ports only (no Pi / OW).
 */

import type { AgentDefinition } from "../domain/definition.ts";
import { MediationError } from "../domain/errors.ts";
import type { PackSnapshot } from "../domain/packs.ts";
import type {
  AgentPresence,
  AttachSurface,
  EngageInput,
  InterruptKind,
  PresenceEvent,
  PresenceStatus,
  RunOutcome,
  SessionRef,
} from "../domain/presence.ts";
import type { EngineSessionHandle } from "../ports/engine.ts";
import { evaluateSettled } from "./settled-policy.ts";

export type DefaultAgentPresenceOptions = {
  readonly id: string;
  readonly definition: AgentDefinition;
  readonly sessionRef: SessionRef;
  readonly packSnapshot: PackSnapshot;
  readonly handle: EngineSessionHandle;
  /** Initial status after materialize (default: idle). */
  readonly status?: PresenceStatus;
};

export class DefaultAgentPresence implements AgentPresence {
  readonly id: string;
  readonly definition: AgentDefinition;
  readonly sessionRef: SessionRef;
  readonly packSnapshot: PackSnapshot;

  private _status: PresenceStatus;
  private readonly handle: EngineSessionHandle;
  private readonly observers = new Set<(event: PresenceEvent) => void>();
  private surface: AttachSurface = { kind: "none" };
  private unsubEngine: (() => void) | null = null;

  constructor(opts: DefaultAgentPresenceOptions) {
    this.id = opts.id;
    this.definition = opts.definition;
    this.sessionRef = opts.sessionRef;
    this.packSnapshot = opts.packSnapshot;
    this.handle = opts.handle;
    this._status = opts.status ?? "idle";

    this.unsubEngine = this.handle.subscribe((e) => {
      if (e.type === "idle") {
        this.emit({ type: "idle", at: e.snapshot.at });
      } else if (e.type === "message") {
        this.emit({ type: "message", role: e.role, text: e.text });
      } else if (e.type === "error") {
        this.emit({ type: "error", message: e.message });
      } else {
        this.emit({ type: "engine", name: e.type, data: e });
      }
    });
  }

  get status(): PresenceStatus {
    return this._status;
  }

  private setStatus(next: PresenceStatus): void {
    if (this._status === next) return;
    this._status = next;
    this.emit({ type: "status", status: next });
  }

  private emit(event: PresenceEvent): void {
    for (const l of this.observers) {
      try {
        l(event);
      } catch {
        // observer errors must not break presence
      }
    }
  }

  async engage(input: EngageInput): Promise<RunOutcome> {
    if (this._status === "disposed") {
      return {
        kind: "failed",
        sessionRef: this.sessionRef,
        error: { message: "Presence is disposed", code: "ENGAGE_FAILED" },
      };
    }
    if (this._status === "engaging") {
      return {
        kind: "failed",
        sessionRef: this.sessionRef,
        error: {
          message: "Presence is already engaging",
          code: "ENGAGE_FAILED",
        },
      };
    }

    this.setStatus("engaging");

    try {
      const mode = input.mode ?? "prompt";
      if (mode === "continue") {
        await this.handle.continue();
      } else {
        await this.handle.prompt(input.text, input.images);
      }

      const idle = await this.handle.waitUntilIdle();
      // S2: no park-tool wiring yet; parkIntent always false
      const decision = evaluateSettled({ idle, parkIntent: false });

      if (!decision.allow) {
        if (decision.reason === "park_intent") {
          this.setStatus("parked");
          return {
            kind: "parked",
            sessionRef: this.sessionRef,
            reason: "park_intent",
            resumeToken: `park:${this.sessionRef}`,
          };
        }
        this.setStatus("idle");
        return {
          kind: "failed",
          sessionRef: this.sessionRef,
          error: {
            message: `Settled policy denied: ${decision.reason}`,
            code: "POLICY_VIOLATION",
          },
        };
      }

      this.setStatus("idle");
      return {
        kind: "settled",
        sessionRef: this.sessionRef,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.status !== "disposed") {
        this.setStatus("idle");
      }
      return {
        kind: "failed",
        sessionRef: this.sessionRef,
        error: {
          message,
          code: "ENGAGE_FAILED",
          cause: err,
        },
      };
    }
  }

  async interrupt(kind: InterruptKind, payload?: unknown): Promise<void> {
    if (this._status === "disposed") {
      throw new MediationError(
        "ENGAGE_FAILED",
        "Cannot interrupt a disposed presence",
      );
    }
    await this.handle.interrupt(kind, payload);
  }

  async attach(surface: AttachSurface): Promise<void> {
    if (this._status === "disposed") {
      throw new MediationError(
        "MATERIALIZE_FAILED",
        "Cannot attach a disposed presence",
      );
    }
    // Rebind UI only — does not reload packs or open a second session
    this.surface = surface;
  }

  async detach(): Promise<void> {
    this.surface = { kind: "none" };
  }

  observe(listener: (event: PresenceEvent) => void): () => void {
    this.observers.add(listener);
    return () => {
      this.observers.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    if (this._status === "disposed") return;
    this.setStatus("disposed");
    this.unsubEngine?.();
    this.unsubEngine = null;
    this.observers.clear();
    await this.handle.dispose();
  }

  /** Current attach surface (for tests / diagnostics). */
  getAttachSurface(): AttachSurface {
    return this.surface;
  }
}
