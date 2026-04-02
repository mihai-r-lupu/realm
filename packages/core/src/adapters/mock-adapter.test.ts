import { describe, it, expect } from 'vitest';
import { MockAdapter } from './mock-adapter.js';
import { WorkflowError } from '../types/workflow-error.js';

const responses = {
  'get-user': { status: 200, data: { id: 1, name: 'Alice' } },
  'create-task': { status: 201, data: { id: 99 } },
};

describe('MockAdapter', () => {
  it('id is set correctly from constructor', () => {
    const adapter = new MockAdapter('my-mock', responses);
    expect(adapter.id).toBe('my-mock');
  });

  it('fetch returns the configured response for a known operation', async () => {
    const adapter = new MockAdapter('test', responses);
    const result = await adapter.fetch('get-user', {}, {});
    expect(result).toEqual({ status: 200, data: { id: 1, name: 'Alice' } });
  });

  it('create returns the configured response for a known operation', async () => {
    const adapter = new MockAdapter('test', responses);
    const result = await adapter.create('create-task', {}, {});
    expect(result).toEqual({ status: 201, data: { id: 99 } });
  });

  it('update returns the configured response for a known operation', async () => {
    const adapter = new MockAdapter('test', responses);
    const result = await adapter.update('get-user', {}, {});
    expect(result.status).toBe(200);
  });

  it('unknown operation throws WorkflowError with code ENGINE_ADAPTER_FAILED', async () => {
    const adapter = new MockAdapter('test', responses);
    await expect(adapter.fetch('nonexistent', {}, {})).rejects.toMatchObject({
      code: 'ENGINE_ADAPTER_FAILED',
    });
    await expect(adapter.fetch('nonexistent', {}, {})).rejects.toBeInstanceOf(WorkflowError);
  });
});
