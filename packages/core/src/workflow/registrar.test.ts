import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonWorkflowStore } from './registrar.js';
import { WorkflowError } from '../types/workflow-error.js';
import type { WorkflowDefinition } from '../types/workflow-definition.js';

function makeDefinition(id: string, version = 1): WorkflowDefinition {
  return {
    id,
    name: `Workflow ${id}`,
    version,
    initial_state: 'created',
    steps: {
      'step-one': {
        description: 'Only step',
        execution: 'auto',
        allowed_from_states: ['created'],
        produces_state: 'completed',
      },
    },
  };
}

describe('JsonWorkflowStore', () => {
  let dir: string;
  let store: JsonWorkflowStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'realm-wf-test-'));
    store = new JsonWorkflowStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('register + get by id returns the same definition', async () => {
    const def = makeDefinition('wf-one');
    await store.register(def);
    const retrieved = await store.get('wf-one');
    expect(retrieved.id).toBe('wf-one');
    expect(retrieved.version).toBe(1);
    expect(Object.keys(retrieved.steps)).toHaveLength(1);
  });

  it('get on unknown id throws WorkflowError', async () => {
    await expect(store.get('nonexistent')).rejects.toThrow(WorkflowError);
  });

  it('list returns all registered workflows', async () => {
    await store.register(makeDefinition('wf-a'));
    await store.register(makeDefinition('wf-b'));
    await store.register(makeDefinition('wf-c'));
    const all = await store.list();
    expect(all).toHaveLength(3);
    const ids = all.map((d) => d.id).sort();
    expect(ids).toEqual(['wf-a', 'wf-b', 'wf-c']);
  });

  it('re-registering same id overwrites previous', async () => {
    await store.register(makeDefinition('wf-one', 1));
    await store.register(makeDefinition('wf-one', 2));
    const retrieved = await store.get('wf-one');
    expect(retrieved.version).toBe(2);
  });
});
