// Processing pipeline — runs content through an ordered sequence of processors.
import type { Processor, ProcessorInput, ProcessorOutput } from '../extensions/processor.js';
import type { ExtensionRegistry } from '../extensions/registry.js';
import { WorkflowError } from '../types/workflow-error.js';

export interface PipelineResult {
  output: ProcessorOutput;
  /** Each entry records which processor ran and its output text length. */
  trace: Array<{ processorId: string; outputLength: number }>;
}

/**
 * Runs content through a sequence of named processors from the registry.
 *
 * If 'compute_hash' is not the last entry in processorNames, it is appended
 * automatically. This guarantees the hash reflects the final content.
 *
 * @param content  Initial ProcessorInput.
 * @param processorNames  Ordered list of processor ids to apply.
 * @param registry  Registry to look up processors by name.
 * @param configs  Optional per-processor config map keyed by processor id.
 * @throws WorkflowError(ENGINE_PROCESSOR_FAILED) if a processor is not found or throws.
 */
export async function runPipeline(
  content: ProcessorInput,
  processorNames: string[],
  registry: ExtensionRegistry,
  configs?: Record<string, Record<string, unknown>>,
): Promise<PipelineResult> {
  const names = [...processorNames];
  if (names[names.length - 1] !== 'compute_hash') {
    names.push('compute_hash');
  }

  const trace: Array<{ processorId: string; outputLength: number }> = [];
  let current: ProcessorInput = content;

  for (const name of names) {
    const processor: Processor | undefined = registry.getProcessor(name);
    if (processor === undefined) {
      throw new WorkflowError(`Processor not found: ${name}`, {
        code: 'ENGINE_PROCESSOR_FAILED',
        category: 'ENGINE',
        agentAction: 'stop',
        retryable: false,
      });
    }

    const config = configs?.[name] ?? {};
    let result: ProcessorOutput;
    try {
      result = await processor.process(current, config);
    } catch (err) {
      if (err instanceof WorkflowError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new WorkflowError(`Processor '${name}' failed: ${message}`, {
        code: 'ENGINE_PROCESSOR_FAILED',
        category: 'ENGINE',
        agentAction: 'stop',
        retryable: false,
      });
    }

    trace.push({ processorId: name, outputLength: result.text.length });
    current = result;
  }

  // current is guaranteed to be a ProcessorOutput since names is non-empty after appending compute_hash
  return { output: current as ProcessorOutput, trace };
}
