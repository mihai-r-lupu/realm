// Processor — stateless content transformation in a processing pipeline.

export interface ProcessorInput {
  text: string;
  metadata: Record<string, unknown>;
}

export interface ProcessorOutput {
  text: string;
  metadata: Record<string, unknown>;
}

export interface Processor {
  readonly id: string;
  process(content: ProcessorInput, config: Record<string, unknown>): Promise<ProcessorOutput>;
}
