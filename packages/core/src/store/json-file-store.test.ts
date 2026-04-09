import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileStore } from './json-file-store.js';
import { WorkflowError } from '../types/workflow-error.js';

async function makeTmpStore(): Promise<{ store: JsonFileStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'realm-test-'));
  return { store: new JsonFileStore(dir), dir };
}

describe('JsonFileStore', () => {
  let store: JsonFileStore;
  let dir: string;

  beforeEach(async () => {
    ({ store, dir } = await makeTmpStore());
  });

  it('create() produces a record with correct fields', async () => {
    const record = await store.create({
      workflowId: 'wf-1',
      workflowVersion: 1,
      initialState: 'created',
      params: { key: 'value' },
    });

    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.workflow_id).toBe('wf-1');
    expect(record.workflow_version).toBe(1);
    expect(record.state).toBe('created');
    expect(record.version).toBe(0);
    expect(record.params).toEqual({ key: 'value' });
    expect(record.evidence).toHaveLength(0);
    expect(record.terminal_state).toBe(false);
  });

  it('create() writes file to disk', async () => {
    const record = await store.create({
      workflowId: 'wf-1',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, `${record.id}.json`))).toBe(true);
  });

  it('get() returns the created record', async () => {
    const created = await store.create({
      workflowId: 'wf-1',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });
    const fetched = await store.get(created.id);
    expect(fetched).toEqual(created);
  });

  it('get() throws STATE_RUN_NOT_FOUND for unknown ID', async () => {
    await expect(store.get('non-existent')).rejects.toMatchObject({
      code: 'STATE_RUN_NOT_FOUND',
    });
    await expect(store.get('non-existent')).rejects.toBeInstanceOf(WorkflowError);
  });

  it('update() increments version and updates updated_at', async () => {
    const created = await store.create({
      workflowId: 'wf-1',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const updated = await store.update({ ...created, state: 'step_done' });
    expect(updated.version).toBe(1);
    expect(updated.state).toBe('step_done');
    expect(updated.updated_at >= created.updated_at).toBe(true);

    const fetched = await store.get(created.id);
    expect(fetched.version).toBe(1);
    expect(fetched.state).toBe('step_done');
  });

  it('update() throws STATE_SNAPSHOT_MISMATCH on version conflict', async () => {
    const created = await store.create({
      workflowId: 'wf-1',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    // First update succeeds
    await store.update({ ...created, state: 'step_done' });

    // Second update with old version should fail
    await expect(store.update({ ...created, state: 'other' })).rejects.toMatchObject({
      code: 'STATE_SNAPSHOT_MISMATCH',
    });
  });

  it('list() returns all created runs', async () => {
    await store.create({
      workflowId: 'wf-1',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });
    await store.create({
      workflowId: 'wf-1',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });
    await store.create({
      workflowId: 'wf-2',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const all = await store.list();
    expect(all).toHaveLength(3);
  });

  it('list() filters by workflowId', async () => {
    await store.create({
      workflowId: 'wf-1',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });
    await store.create({
      workflowId: 'wf-2',
      workflowVersion: 1,
      initialState: 'created',
      params: {},
    });

    const filtered = await store.list('wf-1');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.workflow_id).toBe('wf-1');
  });

  // Cleanup temp dir after each test (best-effort)
  // Note: Vitest afterEach is not imported to keep the test file focused.
  // The OS cleans up tmp dirs on reboot; or tests can call rm(dir, {recursive:true}).
  it('temp dir cleanup works', async () => {
    await rm(dir, { recursive: true, force: true });
  });
});
