// testProcessor — isolated processor test helper.
import type { Processor, ProcessorInput, ProcessorOutput } from '@sensigo/realm';

/**
 * Calls processor.process(content, config) and returns the result.
 * config defaults to {} if not provided.
 */
export async function testProcessor(
  processor: Processor,
  content: ProcessorInput,
  config?: Record<string, unknown>,
): Promise<ProcessorOutput> {
  return processor.process(content, config ?? {});
}
