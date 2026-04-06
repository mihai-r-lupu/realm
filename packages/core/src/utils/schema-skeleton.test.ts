import { describe, it, expect } from 'vitest';
import { generateSchemaSkeleton } from './schema-skeleton.js';

describe('generateSchemaSkeleton', () => {
  it('returns empty object for object type with no properties', () => {
    expect(generateSchemaSkeleton({ type: 'object' })).toEqual({});
  });

  it('returns object with required properties only', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        optional: { type: 'string' },
      },
    };
    const result = generateSchemaSkeleton(schema) as Record<string, unknown>;
    expect(result['name']).toBe('');
    expect('optional' in result).toBe(false);
  });

  it('uses all properties when required is absent', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
      },
    };
    const result = generateSchemaSkeleton(schema) as Record<string, unknown>;
    expect(result['a']).toBe('');
    expect(result['b']).toBe(0);
  });

  it('produces enum placeholder string', () => {
    expect(generateSchemaSkeleton({ type: 'string', enum: ['low', 'medium', 'high'] }))
      .toBe('<low|medium|high>');
  });

  it('produces empty string for plain string', () => {
    expect(generateSchemaSkeleton({ type: 'string' })).toBe('');
  });

  it('produces 0 for number', () => {
    expect(generateSchemaSkeleton({ type: 'number' })).toBe(0);
  });

  it('produces false for boolean', () => {
    expect(generateSchemaSkeleton({ type: 'boolean' })).toBe(false);
  });

  it('produces one-element array for array type', () => {
    const schema = { type: 'array', items: { type: 'string' } };
    expect(generateSchemaSkeleton(schema)).toEqual(['']);
  });

  it('recurses into array items that are objects', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          description: { type: 'string' },
        },
      },
    };
    const result = generateSchemaSkeleton(schema) as Array<Record<string, unknown>>;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]!['severity']).toBe('<critical|high|medium|low>');
    expect('description' in result[0]!).toBe(false); // not required
  });

  it('recurses into nested objects', () => {
    const schema = {
      type: 'object',
      required: ['outer'],
      properties: {
        outer: {
          type: 'object',
          required: ['inner'],
          properties: {
            inner: { type: 'string', enum: ['a', 'b'] },
          },
        },
      },
    };
    const result = generateSchemaSkeleton(schema) as Record<string, Record<string, unknown>>;
    expect(result['outer']!['inner']).toBe('<a|b>');
  });

  it('returns null for unknown type', () => {
    expect(generateSchemaSkeleton({ type: 'unknown' })).toBeNull();
  });

  it('produces empty array when items is absent', () => {
    expect(generateSchemaSkeleton({ type: 'array' })).toEqual([]);
  });

  it('treats schema with properties but no explicit type as object', () => {
    const schema = {
      required: ['findings'],
      properties: {
        findings: { type: 'array', items: { type: 'string' } },
      },
    };
    const result = generateSchemaSkeleton(schema) as Record<string, unknown>;
    expect(typeof result).toBe('object');
    expect(Array.isArray(result['findings'])).toBe(true);
  });
});
