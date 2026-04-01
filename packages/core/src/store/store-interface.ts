// Interface for run record persistence — implemented by JsonFileStore (local) and future Postgres store.
import type { RunRecord } from '../types/run-record.js';

export interface CreateRunOptions {
  workflowId: string;
  workflowVersion: number;
  initialState: string;
  params: Record<string, unknown>;
}

export interface RunStore {
  /** Create a new run record. Returns the created record. */
  create(options: CreateRunOptions): Promise<RunRecord>;

  /** Get a run record by ID. Throws WorkflowError(STATE_RUN_NOT_FOUND) if not found. */
  get(runId: string): Promise<RunRecord>;

  /**
   * Update a run record. Checks that record.version matches the stored version
   * before writing. Throws WorkflowError(STATE_SNAPSHOT_MISMATCH) on version conflict.
   * Increments version on successful write.
   */
  update(record: RunRecord): Promise<RunRecord>;

  /** List all run records, optionally filtered by workflowId. */
  list(workflowId?: string): Promise<RunRecord[]>;
}
