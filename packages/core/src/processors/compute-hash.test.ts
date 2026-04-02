import { describe, it, expect } from 'vitest';
import { computeHash } from './compute-hash.js';

describe('computeHash', () => {
  it('output text is identical to input text', async () => {
    const result = await computeHash.process({ text: 'hello world', metadata: {} }, {});
    expect(result.text).toBe('hello world');
  });

  it('metadata.hash is sha256:{hex} format', async () => {
    const result = await computeHash.process({ text: 'test', metadata: {} }, {});
    expect(result.metadata.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('same input produces same hash', async () => {
    const r1 = await computeHash.process({ text: 'same', metadata: {} }, {});
    const r2 = await computeHash.process({ text: 'same', metadata: {} }, {});
    expect(r1.metadata.hash).toBe(r2.metadata.hash);
  });

  it('different input produces different hash', async () => {
    const r1 = await computeHash.process({ text: 'aaa', metadata: {} }, {});
    const r2 = await computeHash.process({ text: 'bbb', metadata: {} }, {});
    expect(r1.metadata.hash).not.toBe(r2.metadata.hash);
  });
});
