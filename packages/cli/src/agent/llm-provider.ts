// llm-provider.ts — LLM provider interface and factory function for realm agent.
import type { ToolDefinition, ToolExecutor, StepWithToolsResult } from './mcp-types.js';

/** A single LLM call: given a prompt and optional JSON schema, return a parsed JSON object. */
export interface LlmProvider {
  /**
   * Calls the LLM with the step prompt and returns a JSON object.
   * If input_schema is provided, instructs the LLM to conform to it.
   * The returned value is passed directly to executeChain as step params.
   */
  callStep(prompt: string, inputSchema?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Extended interface for providers that support the agentic tool-calling loop.
 * Not all providers implement this — check with isToolCapable() before use.
 */
export interface ToolCapableLlmProvider extends LlmProvider {
  callStepWithTools(
    prompt: string,
    tools: ToolDefinition[],
    executor: ToolExecutor,
    options: {
      inputSchema?: Record<string, unknown>;
      maxToolCalls?: number;
      toolTimeoutMs?: number;
    },
  ): Promise<StepWithToolsResult>;
}

/**
 * Type predicate for narrowing LlmProvider to ToolCapableLlmProvider.
 * Used at startup to validate the provider supports tool-enabled workflows.
 */
export function isToolCapable(provider: LlmProvider): provider is ToolCapableLlmProvider {
  return typeof (provider as ToolCapableLlmProvider).callStepWithTools === 'function';
}

export type ProviderName = 'openai' | 'anthropic';

/**
 * Resolves the correct LLM provider from environment and CLI flags.
 * Throws if no API key is found or the specified package is not installed.
 */
export async function resolveProvider(
  providerFlag: ProviderName | undefined,
  modelFlag: string | undefined,
): Promise<LlmProvider> {
  const hasOpenAI = process.env['OPENAI_API_KEY'] !== undefined;
  const hasAnthropic = process.env['ANTHROPIC_API_KEY'] !== undefined;

  if (!hasOpenAI && !hasAnthropic) {
    throw new Error(
      'realm agent requires an LLM API key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.',
    );
  }

  const provider = providerFlag ?? (hasOpenAI ? 'openai' : 'anthropic');

  if (provider === 'openai') {
    const { OpenAIProvider } = await import('./openai-provider.js');
    return new OpenAIProvider(modelFlag ?? 'gpt-4o');
  } else {
    const { AnthropicProvider } = await import('./anthropic-provider.js');
    return new AnthropicProvider(modelFlag ?? 'claude-sonnet-4-5');
  }
}
