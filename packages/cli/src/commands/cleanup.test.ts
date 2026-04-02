// Tests for the cleanupRuns function — CLI cleanup command logic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupRuns } from './cleanup.js';
import { JsonFileStore } from '@sensigo/realm';
import type { RunRecord } from '@sensigo/realm';
import { v4 as uuidv4 } from 'uuid';

/** Write a RunRecord directly to the store dir, bypassing store.create/update timestamps. */
async function injectRun(dir: string, run: RunRecord): Promise<void> {
  await writeFile(join(dir, `${run.id}.json`), JSON.stringify(run, null, 2), 'utf8');
}

function makeRun(overrides: Partial<RunRecord> & { id?: string }): RunRecord {
  const id = overrides.id ?? uuidv4();
  return {
    id,
    workflow_id: 'test-wf',
    workflow_version: 1,
    state: 'created',
    params: {},
    evidence: [],
    version: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    terminal_state: false,
    ...overrides,
  };
}

describe('cleanupRuns', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-cleanup-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks old non-terminal runs as abandoned', async () => {
    const now = new Date('2024-06-01T12:00:00Z');
    vi.setSystemTime(now);

    const oldTime = new Date(now.getTime() - 2 * 86_400_000).toISOString(); // 2 days ago
    const run = makeRun({ updated_at: oldTime });
    await injectRun(dir, run);

    const store = new JsonFileStore(dir);
    const { affected } = await cleanupRuns({ olderThan: '1d' }, store);

    expect(affected).toHaveLength(1);
    expect(affected[0]?.id).toBe(run.id);

    const updated = await store.get(run.id);
    expect(updated.state).toBe('abandoned');
    expect(updated.terminal_state).toBe(true);
    expect(updated.terminal_reason).toBe('Marked abandoned by realm cleanup');
  });

  it('leaves runs updated within the threshold untouched', async () => {
    const now = new Date('2024-06-01T12:00:00Z');
    vi.setSystemTime(now);

    const recentTime = new Date(now.getTime() - 30 * 60_000).toISOString(); // 30 minutes ago
    const run = makeRun({ updated_at: recentTime });
    await injectRun(dir, run);

    const store = new JsonFileStore(dir);
    const { affected } = await cleanupRuns({ olderThan: '1h' }, store);

    expect(affected).toHaveLength(0);

    const unchanged = await store.get(run.id);
    expect(unchanged.state).toBe('created');
  });

  it('dry-run reports affected runs without writing changes', async () => {
    const now = new Date('2024-06-01T12:00:00Z');
    vi.setSystemTime(now);

    const oldTime = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    const run = makeRun({ updated_at: oldTime });
    await injectRun(dir, run);

    const store = new JsonFileStore(dir);
    const { affected } = await cleanupRuns({ olderThan: '1d', dryRun: true }, store);

    expect(affected).toHaveLength(1);

    // State should NOT have changed because dryRun is true.
    const unchanged = await store.get(run.id);
    expect(unchanged.state).toBe('created');
    expect(unchanged.terminal_state).toBe(false);
  });

  it('skips runs that are already terminal', async () => {
    const now = new Date('2024-06-01T12:00:00Z');
    vi.setSystemTime(now);

    const oldTime = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    const terminalRun = makeRun({ updated_at: oldTime, state: 'completed', terminal_state: true });
    await injectRun(dir, terminalRun);

    const store = new JsonFileStore(dir);
    const { affected } = await cleanupRuns({ olderThan: '1d' }, store);

    expect(affected).toHaveLength(0);
  });
});
