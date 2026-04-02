import { describe, it, expect } from 'vitest';
import { runPipeline } from './processing-pipeline.js';
import { ExtensionRegistry } from '../extensions/registry.js';
import { normalizeText } from '../processors/normalize-text.js';
import { computeHash } from '../processors/compute-hash.js';
import { WorkflowError } from '../types/workflow-error.js';

function makeRegistry(...extra: Parameters<ExtensionRegistry['register']>[]): ExtensionRegistry {
  const r = new ExtensionRegistry();
  r.register('processor', normalizeText.id, normalizeText);
  r.register('processor', computeHash.id, computeHash);
  for (const args of extra) {
    r.register(...args);
  }
  return r;
}

describe('runPipeline', () => {
  it('single processor runs and returns its output', async () => {
    const registry = makeRegistry();
    const input = { text: 'hello', metadata: {} };
    const result = await runPipeline(input, ['normalize_text'], registry);
    expect(result.output.text).toBe('hello');
    expect(result.trace).toHaveLength(2); // normalize_text + compute_hash auto-appended
  });

  it('two processors chain: second receives first output', async () => {
    const registry = makeRegistry();
    const input = { text: '“hello”', metadata: {} };
    const result = await runPipeline(input, ['normalize_text', 'compute_hash'], registry);
    expect(result.output.text).toBe('"hello"');
    expect(result.output.metadata.hash).toMatch(/^sha256:/);
  });

  it('compute_hash is appended automatically when not last', async () => {
    const registry = makeRegistry();
    const input = { text: 'test', metadata: {} };
    const result = await runPipeline(input, ['normalize_text'], registry);
    const last = result.trace[result.trace.length - 1];
    expect(last?.processorId).toBe('compute_hash');
  });

  it('compute_hash is not added twice when already last', async () => {
    const registry = makeRegistry();
    const input = { text: 'test', metadata: {} };
    const result = await runPipeline(input, ['normalize_text', 'compute_hash'], registry);
    const hashEntries = result.trace.filter((t) => t.processorId === 'compute_hash');
    expect(hashEntries).toHaveLength(1);
  });

  it('missing processor throws WorkflowError with code ENGINE_PROCESSOR_FAILED', async () => {
    const registry = makeRegistry();
    const input = { text: 'test', metadata: {} };
    await expect(runPipeline(input, ['nonexistent'], registry)).rejects.toMatchObject({
      code: 'ENGINE_PROCESSOR_FAILED',
    });
    await expect(runPipeline(input, ['nonexistent'], registry)).rejects.toBeInstanceOf(WorkflowError);
  });
});
