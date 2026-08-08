/**
 * Mock EnginePort — unit path for S2 (no Pi).
 *
 * openSession → handle with sessionRef (new or resume).
 * prompt / continue → after microtask emit idle via subscribe;
 * waitUntilIdle resolves when idle arrives (or immediately if already idle).
 *
 * Note: relative imports use `.ts` so `node --experimental-strip-types` resolves
 * value imports without emitted .js (package is noEmit / strip-types first).
 */

import { asSessionRef, type SessionRef } from "../../domain/presence.ts";
import type {
  EngineEvent,
  EnginePort,
  EngineSessionHandle,
  IdleSnapshot,
  OpenSessionRequest,
} from "../../ports/engine.ts";

type MockEngineAdapterOptions = {
  /** Fixed sessionRef for new sessions (default: mock-session-<n>). */
  sessionRefFactory?: () => SessionRef;
};

let sessionSeq = 0;

function nextSessionRef(): SessionRef {
  sessionSeq += 1;
  return asSessionRef(`mock-session-${sessionSeq}`);
}

type IdleWaiter = {
  resolve: (s: IdleSnapshot) => void;
  reject: (err: Error) => void;
  cleanup?: () => void;
};

export class MockEngineSessionHandle implements EngineSessionHandle {
  readonly sessionRef: SessionRef;
  private listeners = new Set<(e: EngineEvent) => void>();
  private disposed = false;
  private idleWaiters: IdleWaiter[] = [];
  private lastIdle: IdleSnapshot | null;
  /** True while a turn is in flight (between prompt/continue and idle emit). */
  private busy = false;

  constructor(sessionRef: SessionRef, initialIdle = true) {
    this.sessionRef = sessionRef;
    this.lastIdle = initialIdle
      ? { at: new Date().toISOString(), reason: "session_open" }
      : null;
  }

  private emit(e: EngineEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // listener errors must not break the mock engine
      }
    }
  }

  private emitIdle(reason?: string): IdleSnapshot {
    const snapshot: IdleSnapshot = {
      at: new Date().toISOString(),
      reason,
    };
    this.busy = false;
    this.lastIdle = snapshot;
    this.emit({ type: "idle", snapshot });
    const waiters = this.idleWaiters.splice(0);
    for (const w of waiters) {
      w.cleanup?.();
      w.resolve(snapshot);
    }
    return snapshot;
  }

  private scheduleIdle(reason: string): void {
    this.busy = true;
    this.lastIdle = null;
    queueMicrotask(() => {
      if (this.disposed) return;
      this.emitIdle(reason);
    });
  }

  async prompt(text: string, images?: readonly unknown[]): Promise<void> {
    if (this.disposed) {
      throw new Error("MockEngineSessionHandle: disposed");
    }
    this.emit({ type: "message", role: "user", text });
    if (images && images.length > 0) {
      this.emit({ type: "raw", name: "images", data: { count: images.length } });
    }
    this.scheduleIdle("prompt_complete");
  }

  async continue(): Promise<void> {
    if (this.disposed) {
      throw new Error("MockEngineSessionHandle: disposed");
    }
    this.emit({ type: "raw", name: "continue" });
    this.scheduleIdle("continue_complete");
  }

  async interrupt(
    kind: "steer" | "followUp" | "abort",
    payload?: unknown,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("MockEngineSessionHandle: disposed");
    }
    this.emit({ type: "raw", name: "interrupt", data: { kind, payload } });
    if (kind === "abort" && this.busy) {
      this.emitIdle("aborted");
    }
  }

  subscribe(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  waitUntilIdle(opts?: { signal?: AbortSignal }): Promise<IdleSnapshot> {
    if (this.disposed) {
      return Promise.reject(new Error("MockEngineSessionHandle: disposed"));
    }
    if (!this.busy && this.lastIdle) {
      return Promise.resolve(this.lastIdle);
    }
    return new Promise<IdleSnapshot>((resolve, reject) => {
      const signal = opts?.signal;
      const entry: IdleWaiter = { resolve, reject };

      if (signal) {
        if (signal.aborted) {
          reject(new Error("MockEngineSessionHandle: waitUntilIdle aborted"));
          return;
        }
        const onAbort = () => {
          const idx = this.idleWaiters.indexOf(entry);
          if (idx >= 0) this.idleWaiters.splice(idx, 1);
          reject(new Error("MockEngineSessionHandle: waitUntilIdle aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        entry.cleanup = () => signal.removeEventListener("abort", onAbort);
      }

      this.idleWaiters.push(entry);
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const waiters = this.idleWaiters.splice(0);
    for (const w of waiters) {
      w.cleanup?.();
      w.reject(new Error("MockEngineSessionHandle: disposed"));
    }
    this.listeners.clear();
  }
}

/**
 * In-memory EnginePort for tests and headless S2 pilot.
 * No Pi / real engine session constructor — mock-first path only.
 */
export class MockEnginePort implements EnginePort {
  private readonly sessionRefFactory: () => SessionRef;
  /** Sessions opened by this port (for test inspection). */
  readonly opened: MockEngineSessionHandle[] = [];

  constructor(opts: MockEngineAdapterOptions = {}) {
    this.sessionRefFactory = opts.sessionRefFactory ?? nextSessionRef;
  }

  async openSession(req: OpenSessionRequest): Promise<EngineSessionHandle> {
    const sessionRef = req.resume ?? this.sessionRefFactory();
    const handle = new MockEngineSessionHandle(sessionRef, true);
    this.opened.push(handle);
    return handle;
  }
}
