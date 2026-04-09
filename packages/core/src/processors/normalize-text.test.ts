import { describe, it, expect } from 'vitest';
import { normalizeText } from './normalize-text.js';

describe('normalizeText', () => {
  it('replaces smart quotes when smart_quotes: true (default)', async () => {
    const result = await normalizeText.process(
      { text: '\u201CHello\u201D and \u2018world\u2019', metadata: {} },
      {},
    );
    expect(result.text).toBe('"Hello" and \'world\'');
    expect(result.metadata.normalized_quotes).toBe(4);
  });

  it('replaces em dash and en dash when dashes: true (default)', async () => {
    const result = await normalizeText.process({ text: 'a\u2014b\u2013c', metadata: {} }, {});
    expect(result.text).toBe('a--b-c');
    expect(result.metadata.normalized_dashes).toBe(2);
  });

  it('text is unchanged when smart_quotes: false and dashes: false', async () => {
    const original = '\u201CHi\u201D a\u2014b';
    const result = await normalizeText.process(
      { text: original, metadata: {} },
      { smart_quotes: false, dashes: false },
    );
    expect(result.text).toBe(original);
    expect(result.metadata.normalized_quotes).toBe(0);
    expect(result.metadata.normalized_dashes).toBe(0);
  });

  it('metadata.normalized_quotes and normalized_dashes count replacements', async () => {
    const result = await normalizeText.process(
      { text: '\u201Ca\u201D \u2018b\u2019 a\u2014b\u2013c', metadata: {} },
      {},
    );
    expect(result.metadata.normalized_quotes).toBe(4);
    expect(result.metadata.normalized_dashes).toBe(2);
  });

  it('preserves existing metadata', async () => {
    const result = await normalizeText.process(
      { text: 'hello', metadata: { custom_key: 'custom_value' } },
      {},
    );
    expect(result.metadata.custom_key).toBe('custom_value');
  });
});
