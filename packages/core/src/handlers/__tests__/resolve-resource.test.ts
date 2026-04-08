import { describe, it, expect } from 'vitest';
import { resolveResource } from '../primitives/resolve-resource.js';

describe('resolveResource', () => {
  it('returns the value when resources, step, and field all exist', () => {
    const resources = { fetch_document: { text: 'hello world' } };
    expect(resolveResource(resources, 'fetch_document', 'text')).toBe('hello world');
  });

  it('returns undefined when resources is undefined', () => {
    expect(resolveResource(undefined, 'fetch_document', 'text')).toBeUndefined();
  });

  it('returns undefined when the step does not exist in resources', () => {
    const resources = { other_step: { text: 'hello' } };
    expect(resolveResource(resources, 'fetch_document', 'text')).toBeUndefined();
  });

  it('returns undefined when the field does not exist in the step output', () => {
    const resources = { fetch_document: { content: 'hello' } };
    expect(resolveResource(resources, 'fetch_document', 'text')).toBeUndefined();
  });

  it('returns the value when it is an empty string (falsy but valid)', () => {
    const resources = { fetch_document: { text: '' } };
    expect(resolveResource(resources, 'fetch_document', 'text')).toBe('');
  });

  it('returns the value when it is 0 (falsy but valid)', () => {
    const resources = { fetch_document: { count: 0 } };
    expect(resolveResource(resources, 'fetch_document', 'count')).toBe(0);
  });
});
