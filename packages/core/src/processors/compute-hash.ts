// compute-hash processor — appends a SHA-256 hash of the text to metadata.
import { createHash } from 'node:crypto';
import type { Processor, ProcessorInput, ProcessorOutput } from '../extensions/processor.js';

/** Computes SHA-256 of the input text and stores it as metadata.hash in 'sha256:{hex}' format. */
export const computeHash: Processor = {
  id: 'compute_hash',
  async process(content: ProcessorInput, _config: Record<string, unknown>): Promise<ProcessorOutput> {
    const hash = `sha256:${createHash('sha256').update(content.text).digest('hex')}`;
    return {
      text: content.text,
      metadata: { ...content.metadata, hash },
    };
  },
};
