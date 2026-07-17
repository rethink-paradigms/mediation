/**
 * In-memory JoinStore — dual-durability index for tests and single-process pilots.
 * Not durable across process restarts (S5a).
 */

import type {
  EngagementRecord,
  EngagementStatus,
  RunId,
} from "../../domain/engagement.ts";
import type { SessionRef } from "../../domain/presence.ts";
import type { JoinStore } from "../../ports/join.ts";

export class MemoryJoinStore implements JoinStore {
  private readonly byRun = new Map<string, EngagementRecord>();
  private readonly bySession = new Map<string, string>();

  async put(record: EngagementRecord): Promise<void> {
    const prev = this.byRun.get(record.runId);
    if (prev && prev.sessionRef !== record.sessionRef) {
      this.bySession.delete(prev.sessionRef);
    }
    this.byRun.set(record.runId, record);
    this.bySession.set(record.sessionRef, record.runId);
  }

  async getByRunId(runId: RunId): Promise<EngagementRecord | null> {
    return this.byRun.get(runId) ?? null;
  }

  async getBySessionRef(
    sessionRef: SessionRef,
  ): Promise<EngagementRecord | null> {
    const runId = this.bySession.get(sessionRef);
    if (!runId) return null;
    return this.byRun.get(runId) ?? null;
  }

  async updateStatus(runId: RunId, status: EngagementStatus): Promise<void> {
    const cur = this.byRun.get(runId);
    if (!cur) {
      throw new Error(`MemoryJoinStore: no record for runId ${runId}`);
    }
    const next: EngagementRecord = {
      ...cur,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.byRun.set(runId, next);
  }

  /** Test/diagnostic: number of stored join rows. */
  size(): number {
    return this.byRun.size;
  }

  /** Test helper: clear all rows. */
  clear(): void {
    this.byRun.clear();
    this.bySession.clear();
  }
}
