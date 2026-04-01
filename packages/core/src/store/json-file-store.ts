// Local file-backed run store. Stores each run as a JSON file in ~/.realm/runs/.
// Uses proper-lockfile to prevent concurrent writes.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import lockfile from 'proper-lockfile';
import type { RunRecord } from '../types/run-record.js';
import { WorkflowError } from '../types/workflow-error.js';
import type { RunStore, CreateRunOptions } from './store-interface.js';

const DEFAULT_RUNS_DIR = join(homedir(), '.realm', 'runs');

export class JsonFileStore implements RunStore {
  private readonly runsDir: string;

  constructor(runsDir?: string) {
    this.runsDir = runsDir ?? DEFAULT_RUNS_DIR;
  }

  private filePath(runId: string): string {
    return join(this.runsDir, `${runId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.runsDir, { recursive: true });
  }

  async create(options: CreateRunOptions): Promise<RunRecord> {
    await this.ensureDir();
    const now = new Date().toISOString();
    const record: RunRecord = {
      id: uuidv4(),
      workflow_id: options.workflowId,
      workflow_version: options.workflowVersion,
      state: options.initialState,
      version: 0,
      params: options.params,
      evidence: [],
      created_at: now,
      updated_at: now,
      terminal_state: false,
    };
    await writeFile(this.filePath(record.id), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  async get(runId: string): Promise<RunRecord> {
    const path = this.filePath(runId);
    if (!existsSync(path)) {
      throw new WorkflowError(`Run not found: ${runId}`, {
        code: 'STATE_RUN_NOT_FOUND',
        category: 'STATE',
        agentAction: 'report_to_user',
        retryable: false,
        details: { runId },
      });
    }
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as RunRecord;
  }

  async update(record: RunRecord): Promise<RunRecord> {
    await this.ensureDir();
    const path = this.filePath(record.id);

    // Ensure the file exists before locking (proper-lockfile requires the file to exist)
    if (!existsSync(path)) {
      throw new WorkflowError(`Run not found: ${record.id}`, {
        code: 'STATE_RUN_NOT_FOUND',
        category: 'STATE',
        agentAction: 'report_to_user',
        retryable: false,
        details: { runId: record.id },
      });
    }

    const release = await lockfile.lock(path, { retries: { retries: 3, minTimeout: 50 } });
    try {
      const raw = await readFile(path, 'utf8');
      const stored = JSON.parse(raw) as RunRecord;

      if (stored.version !== record.version) {
        throw new WorkflowError('Version conflict — run was modified by another process', {
          code: 'STATE_SNAPSHOT_MISMATCH',
          category: 'STATE',
          agentAction: 'report_to_user',
          retryable: true,
          details: { runId: record.id, expected: record.version, actual: stored.version },
        });
      }

      const updated: RunRecord = {
        ...record,
        version: record.version + 1,
        updated_at: new Date().toISOString(),
      };
      await writeFile(path, JSON.stringify(updated, null, 2), 'utf8');
      return updated;
    } finally {
      await release();
    }
  }

  async list(workflowId?: string): Promise<RunRecord[]> {
    await this.ensureDir();
    const entries: string[] = await readdir(this.runsDir);
    const jsonFiles: string[] = entries.filter((f: string) => f.endsWith('.json'));

    const records: RunRecord[] = await Promise.all(
      jsonFiles.map(async (file: string) => {
        const raw = await readFile(join(this.runsDir, file), 'utf8');
        return JSON.parse(raw) as RunRecord;
      }),
    );

    if (workflowId !== undefined) {
      return records.filter((r: RunRecord) => r.workflow_id === workflowId);
    }
    return records;
  }
}
