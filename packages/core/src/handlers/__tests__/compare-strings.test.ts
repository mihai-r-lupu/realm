import { describe, it, expect } from 'vitest';
import { compareStrings } from '../primitives/compare-strings.js';

describe('compareStrings', () => {
  describe('exact mode', () => {
    it('returns true when a === b', () => {
      expect(compareStrings('hello', 'hello', 'exact')).toBe(true);
    });

    it('returns false when a !== b', () => {
      expect(compareStrings('hello', 'world', 'exact')).toBe(false);
    });

    it('is case-sensitive', () => {
      expect(compareStrings('Hello', 'hello', 'exact')).toBe(false);
    });
  });

  describe('prefix mode', () => {
    it('returns true when a starts with b', () => {
      expect(compareStrings('hello world', 'hello', 'prefix')).toBe(true);
    });

    it('returns false when a does not start with b', () => {
      expect(compareStrings('world hello', 'hello', 'prefix')).toBe(false);
    });

    it('returns true when b is empty string (every string starts with "")', () => {
      expect(compareStrings('anything', '', 'prefix')).toBe(true);
    });
  });

  describe('regex mode', () => {
    it('returns true when the pattern matches', () => {
      expect(compareStrings('hello123', '\\d+', 'regex')).toBe(true);
    });

    it('returns false when the pattern does not match', () => {
      expect(compareStrings('hello', '^\\d+$', 'regex')).toBe(false);
    });

    it('returns false (not throws) for an invalid regex pattern', () => {
      expect(compareStrings('hello', '[invalid', 'regex')).toBe(false);
    });

    it('is case-sensitive by default', () => {
      expect(compareStrings('Hello', '^hello$', 'regex')).toBe(false);
    });
  });
});
