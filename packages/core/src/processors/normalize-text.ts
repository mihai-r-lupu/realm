// normalize-text processor — replaces smart quotes and typographic dashes with ASCII equivalents.
import type { Processor, ProcessorInput, ProcessorOutput } from '../extensions/processor.js';

export interface NormalizeTextConfig {
  smart_quotes?: boolean;
  dashes?: boolean;
}

/** Replaces Unicode smart quotes and dashes with plain ASCII equivalents. */
export const normalizeText: Processor = {
  id: 'normalize_text',
  async process(content: ProcessorInput, config: Record<string, unknown>): Promise<ProcessorOutput> {
    const cfg = config as NormalizeTextConfig;
    const smartQuotes = cfg.smart_quotes !== false;
    const dashes = cfg.dashes !== false;

    let text = content.text;
    let normalizedQuotes = 0;
    let normalizedDashes = 0;

    if (smartQuotes) {
      for (const ch of ['“', '”', '‘', '’']) {
        const replacement = ch === '“' || ch === '”' ? '"' : "'";
        const regex = new RegExp(ch, 'g');
        const before = text;
        text = text.replace(regex, replacement);
        normalizedQuotes += countOccurrences(before, ch);
      }
    }

    if (dashes) {
      const emBefore = text;
      text = text.replace(/—/g, '--');
      normalizedDashes += countOccurrences(emBefore, '—');
      const enBefore = text;
      text = text.replace(/–/g, '-');
      normalizedDashes += countOccurrences(enBefore, '–');
    }

    return {
      text,
      metadata: {
        ...content.metadata,
        normalized_quotes: normalizedQuotes,
        normalized_dashes: normalizedDashes,
      },
    };
  },
};

function countOccurrences(str: string, ch: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = str.indexOf(ch, idx)) !== -1) {
    count++;
    idx += ch.length;
  }
  return count;
}
