/**
 * SqliteJoinStore — durable dual-durability index (D0 P4 / S6).
 *
 * Uses Node built-in `node:sqlite` (DatabaseSync). Survives process restart
 * when opened on a file path. `:memory:` is allowed for tests.
 *
 * MemoryJoinStore remains for pure unit tests; this is the pilot durable store.
 */

import { DatabaseSync } from "node:sqlite";

import type { EngineKind } from "../../domain/engine.ts";
import type {
  EngagementRecord,
  EngagementStatus,
  RunId,
} from "../../domain/engagement.ts";
import type { PackSnapshot } from "../../domain/packs.ts";
import { asSessionRef, type SessionRef } from "../../domain/presence.ts";
import type { JoinStore } from "../../ports/join.ts";

export type SqliteJoinStoreOptions = {
  /**
   * Filesystem path, or `:memory:` for non-durable (still SQL-backed) tests.
   */
  readonly path: string;
  /** Open read-only (default false). */
  readonly readOnly?: boolean;
};

type JoinRow = {
  run_id: string;
  session_ref: string;
  definition_id: string;
  pack_snapshot_json: string;
  status: string;
  parked_json: string | null;
  updated_at: string;
  engine: string | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS engagement_join (
  run_id TEXT PRIMARY KEY NOT NULL,
  session_ref TEXT NOT NULL UNIQUE,
  definition_id TEXT NOT NULL,
  pack_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL,
  parked_json TEXT,
  updated_at TEXT NOT NULL,
  engine TEXT
);
CREATE INDEX IF NOT EXISTS idx_engagement_join_session
  ON engagement_join(session_ref);
`;

/**
 * S2e migration: add the engine column to pre-existing tables (created before
 * engine selection landed). Safe no-op when the column already exists.
 */
function ensureEngineColumn(db: DatabaseSync): void {
  const cols = db
    .prepare("PRAGMA table_info(engagement_join)")
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "engine")) {
    db.exec("ALTER TABLE engagement_join ADD COLUMN engine TEXT");
  }
}

function rowToRecord(row: JoinRow): EngagementRecord {
  const packSnapshot = JSON.parse(row.pack_snapshot_json) as PackSnapshot;
  const parked =
    row.parked_json === null || row.parked_json === ""
      ? undefined
      : (JSON.parse(row.parked_json) as {
          reason: string;
          resumeToken: string;
        });
  return {
    runId: row.run_id as RunId,
    sessionRef: asSessionRef(row.session_ref),
    definitionId: row.definition_id,
    packSnapshot,
    status: row.status as EngagementStatus,
    ...(parked ? { parked } : {}),
    updatedAt: row.updated_at,
    ...(row.engine !== null && row.engine !== ""
      ? { engine: row.engine as EngineKind }
      : {}),
  };
}

/**
 * Durable JoinStore over SQLite (node:sqlite).
 * Call `close()` when done with a long-lived file-backed instance.
 */
export class SqliteJoinStore implements JoinStore {
  private readonly db: DatabaseSync;

  constructor(opts: SqliteJoinStoreOptions) {
    this.db = new DatabaseSync(opts.path, {
      readOnly: opts.readOnly ?? false,
    });
    // Multi-process safety: WAL allows concurrent readers + one writer.
    // busy_timeout retries on SQLITE_BUSY instead of throwing immediately.
    if (opts.path !== ":memory:") {
      this.db.exec("PRAGMA busy_timeout = 5000;");
      if (!(opts.readOnly ?? false)) {
        this.db.exec("PRAGMA journal_mode = WAL;");
      }
    }
    if (!(opts.readOnly ?? false)) {
      this.db.exec(SCHEMA);
      ensureEngineColumn(this.db);
    }
  }


  async put(record: EngagementRecord): Promise<void> {
    const parkedJson = record.parked
      ? JSON.stringify(record.parked)
      : null;
    // BEGIN IMMEDIATE: prevents DELETE-INSERT gap from racing with concurrent writers.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // session_ref is UNIQUE: clear prior row that held this session under another run
      this.db
        .prepare(
          `DELETE FROM engagement_join
           WHERE session_ref = ? AND run_id != ?`,
        )
        .run(record.sessionRef, record.runId);

      this.db
        .prepare(
          `INSERT INTO engagement_join (
             run_id, session_ref, definition_id, pack_snapshot_json,
             status, parked_json, updated_at, engine
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             session_ref = excluded.session_ref,
             definition_id = excluded.definition_id,
             pack_snapshot_json = excluded.pack_snapshot_json,
             status = excluded.status,
             parked_json = excluded.parked_json,
             updated_at = excluded.updated_at,
             engine = excluded.engine`,
        )
        .run(
          record.runId,
          record.sessionRef,
          record.definitionId,
          JSON.stringify(record.packSnapshot),
          record.status,
          parkedJson,
          record.updatedAt,
          record.engine ?? null,
        );
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }


  async getByRunId(runId: RunId): Promise<EngagementRecord | null> {
    const row = this.db
      .prepare(
        `SELECT run_id, session_ref, definition_id, pack_snapshot_json,
                status, parked_json, updated_at, engine
         FROM engagement_join WHERE run_id = ?`,
      )
      .get(runId) as JoinRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async getBySessionRef(
    sessionRef: SessionRef,
  ): Promise<EngagementRecord | null> {
    const row = this.db
      .prepare(
        `SELECT run_id, session_ref, definition_id, pack_snapshot_json,
                status, parked_json, updated_at, engine
         FROM engagement_join WHERE session_ref = ?`,
      )
      .get(sessionRef) as JoinRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async updateStatus(runId: RunId, status: EngagementStatus): Promise<void> {
    const cur = await this.getByRunId(runId);
    if (!cur) {
      throw new Error(`SqliteJoinStore: no record for runId ${runId}`);
    }
    await this.put({
      ...cur,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Close underlying database (file handles). */
  close(): void {
    this.db.close();
  }
}


