import { describe, it, expect } from 'vitest';
import { walkField } from '../primitives/walk-field.js';

describe('walkField', () => {
  it('returns empty array for primitives', () => {
    expect(walkField('hello', 'x')).toEqual([]);
    expect(walkField(42, 'x')).toEqual([]);
    expect(walkField(null, 'x')).toEqual([]);
    expect(walkField(true, 'x')).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(walkField([], 'x')).toEqual([]);
  });

  it('returns the object itself when it has the field at top level', () => {
    const obj = { verbatim_quote: 'exact text', field_id: 'q1' };
    expect(walkField(obj, 'verbatim_quote')).toEqual([obj]);
  });

  it('finds the field in objects nested inside an array', () => {
    const obj = { verbatim_quote: 'some text' };
    const result = walkField([{ other: 1 }, obj], 'verbatim_quote');
    expect(result).toEqual([obj]);
  });

  it('finds multiple matches across different objects', () => {
    const a = { verbatim_quote: 'text a' };
    const b = { verbatim_quote: 'text b' };
    const result = walkField([a, b, { no_quote: true }], 'verbatim_quote');
    expect(result).toEqual([a, b]);
  });

  it('does not skip an object that has the field even if its children also have it', () => {
    const inner = { verbatim_quote: 'inner' };
    const outer = { verbatim_quote: 'outer', nested: inner };
    const result = walkField(outer, 'verbatim_quote');
    expect(result).toContain(outer);
    expect(result).toContain(inner);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no object has the field', () => {
    expect(walkField([{ a: 1 }, { b: 2 }], 'verbatim_quote')).toEqual([]);
  });

  it('walks nested object values recursively', () => {
    const deep = { verbatim_quote: 'deep value' };
    const structure = { level1: { level2: deep } };
    const result = walkField(structure, 'verbatim_quote');
    expect(result).toEqual([deep]);
  });
});
