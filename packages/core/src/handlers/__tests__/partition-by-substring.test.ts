import { describe, it, expect } from 'vitest';
import { partitionBySubstring } from '../primitives/partition-by-substring.js';

const SOURCE = 'The quick brown fox jumps over the lazy dog';

describe('partitionBySubstring', () => {
  it('accepts a candidate whose quote appears in the source text', () => {
    const candidates = [{ verbatim_quote: 'quick brown fox' }];
    const { accepted, rejected } = partitionBySubstring(candidates, 'verbatim_quote', SOURCE);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('rejects a candidate whose quote does not appear in the source text', () => {
    const candidates = [{ verbatim_quote: 'slow white cat' }];
    const { accepted, rejected } = partitionBySubstring(candidates, 'verbatim_quote', SOURCE);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it('rejects a candidate missing the quoteField entirely', () => {
    const candidates = [{ field_id: 'q1', value: 'something' }];
    const { accepted, rejected } = partitionBySubstring(candidates, 'verbatim_quote', SOURCE);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it('rejects a candidate whose quoteField value is not a string', () => {
    const candidates = [{ verbatim_quote: 42 }];
    const { accepted, rejected } = partitionBySubstring(candidates, 'verbatim_quote', SOURCE);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it('rejects all candidates when sourceText is empty', () => {
    const candidates = [{ verbatim_quote: 'quick' }, { verbatim_quote: 'fox' }];
    const { accepted, rejected } = partitionBySubstring(candidates, 'verbatim_quote', '');
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(2);
  });

  it('matching is case-sensitive (exact substring, no normalization)', () => {
    const candidates = [{ verbatim_quote: 'Quick Brown Fox' }];
    const { accepted, rejected } = partitionBySubstring(candidates, 'verbatim_quote', SOURCE);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it('handles multiple candidates, some passing and some failing', () => {
    const candidates = [
      { verbatim_quote: 'quick brown fox' },
      { verbatim_quote: 'invisible text' },
      { verbatim_quote: 'lazy dog' },
    ];
    const { accepted, rejected } = partitionBySubstring(candidates, 'verbatim_quote', SOURCE);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(1);
  });

  it('returns empty accepted and rejected arrays when candidates is empty', () => {
    const { accepted, rejected } = partitionBySubstring([], 'verbatim_quote', SOURCE);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });
});
