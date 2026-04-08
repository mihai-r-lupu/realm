import { describe, it, expect } from 'vitest';
import { countResults } from '../primitives/count-results.js';

describe('countResults', () => {
  it('candidates_found equals accepted + rejected', () => {
    const accepted = [{ a: 1 }, { b: 2 }];
    const rejected = [{ c: 3 }];
    const result = countResults(accepted, rejected);
    expect(result.candidates_found).toBe(3);
  });

  it('candidates_found is 0 when both arrays are empty', () => {
    const result = countResults([], []);
    expect(result.candidates_found).toBe(0);
    expect(result.accepted_count).toBe(0);
    expect(result.rejected_count).toBe(0);
  });

  it('accepted_count and rejected_count match array lengths', () => {
    const accepted = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const rejected = [{ y: 1 }];
    const result = countResults(accepted, rejected);
    expect(result.accepted_count).toBe(3);
    expect(result.rejected_count).toBe(1);
    expect(result.candidates_found).toBe(4);
  });
});
