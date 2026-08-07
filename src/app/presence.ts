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
import { outcomeFromError, outcomeFromIdle } from "./outcomes.ts";

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

  private internalStatus: PresenceStatus;
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
    this.internalStatus = opts.status ?? "idle";

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
    return this.internalStatus;
  }

  private setStatus(next: PresenceStatus): void {
    if (this.internalStatus === next) return;
    this.internalStatus = next;
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
    if (this.internalStatus === "disposed") {
      return outcomeFromError({
        sessionRef: this.sessionRef,
        error: "Presence is disposed",
        code: "ENGAGE_FAILED",
      });
    }
    if (this.internalStatus === "engaging") {
      return outcomeFromError({
        sessionRef: this.sessionRef,
        error: "Presence is already engaging",
        code: "ENGAGE_FAILED",
      });
    }

    this.setStatus("engaging");

    try {
      const mode = input.mode ?? "prompt";
      if (mode === "continue") {
        // D1 ParkBridge: the engine handle appends the bridge (explicit
        // bridgeText, else the payload text) as a user message when the last
        // transcript role is assistant — making continue legal after a full
        // settled park on real Pi (issue #1).
        await this.handle.continue({
          bridgeText: input.bridgeText ?? input.text,
        });
      } else {
        await this.handle.prompt(input.text, input.images);
      }

      const idle = await this.handle.waitUntilIdle();
      // OutcomeMapper (software-architecture §4.3): idle + park intent →
      // Settled | Parked | Failed (policy denial) in one normalization point.
      const outcome = outcomeFromIdle({
        sessionRef: this.sessionRef,
        idle,
        parkIntent: input.parkIntent === true,
        parkReason: input.parkReason,
        text: input.text,
        mode,
      });
      if (outcome.kind === "parked") {
        this.setStatus("parked");
      } else {
        this.setStatus("idle");
      }
      return outcome;
    } catch (err) {
      if (this.status !== "disposed") {
        this.setStatus("idle");
      }
      // OutcomeMapper: thrown engine error → Failed (code ENGAGE_FAILED,
      // raw error preserved as cause for in-process diagnostics).
      return outcomeFromError({
        sessionRef: this.sessionRef,
        error: err,
        code: "ENGAGE_FAILED",
        withCause: true,
      });
    }
  }

  async interrupt(kind: InterruptKind, payload?: unknown): Promise<void> {
    if (this.internalStatus === "disposed") {
      throw new MediationError(
        "ENGAGE_FAILED",
        "Cannot interrupt a disposed presence",
      );
    }
    await this.handle.interrupt(kind, payload);
  }

  async attach(surface: AttachSurface): Promise<void> {
    if (this.internalStatus === "disposed") {
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
    if (this.internalStatus === "disposed") return;
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

