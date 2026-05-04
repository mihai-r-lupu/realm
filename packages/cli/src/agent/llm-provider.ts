// llm-provider.ts — LLM provider interface and factory function for realm agent.
import type { ToolDefinition, ToolExecutor, StepWithToolsResult } from './mcp-types.js';

/**
 * Abstract base class for LLM providers used by realm agent.
 * Extend this class to implement a custom provider.
 */
export abstract class LlmProvider {
  /** Call the LLM with a step prompt and return a JSON object. */
  abstract callStep(
    prompt: string,
    inputSchema?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

/**
 * Extended abstract class for providers that support the agentic tool-calling loop.
 * Extend this class if your provider can drive tool-enabled workflow steps.
 */
export abstract class ToolCapableLlmProvider extends LlmProvider {
  abstract callStepWithTools(
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
 * Returns true if the provider supports the agentic tool-calling loop.
 */
export function isToolCapable(provider: LlmProvider): provider is ToolCapableLlmProvider {
  return provider instanceof ToolCapableLlmProvider;
}

export type ProviderName = 'openai' | 'anthropic';

/**
 * Resolves the correct LLM provider from environment and CLI flags.
 * Throws if no API key is found or the specified package is not installed.
 */
export async function resolveProvider(
  providerFlag: ProviderName | undefined,
  modelFlag: string | undefined,
  baseUrlFlag?: string,
): Promise<LlmProvider> {
  const hasOpenAI = process.env['OPENAI_API_KEY'] !== undefined;
  const hasAnthropic = process.env['ANTHROPIC_API_KEY'] !== undefined;

  if (!hasOpenAI && !hasAnthropic) {
    throw new Error(
      'realm agent requires an LLM API key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.',
    );
  }

  const provider = providerFlag ?? (hasOpenAI ? 'openai' : 'anthropic');

  if (baseUrlFlag !== undefined && provider === 'anthropic') {
    throw new Error(
      '--base-url is only supported with --provider openai (or OpenAI-compatible endpoints). ' +
        'For Anthropic, configure the endpoint via the ANTHROPIC_BASE_URL environment variable.',
    );
  }

  if (provider === 'openai') {
    const { OpenAIProvider } = await import('./openai-provider.js');
    return new OpenAIProvider(modelFlag ?? 'gpt-4o', baseUrlFlag);
  } else {
    const { AnthropicProvider } = await import('./anthropic-provider.js');
    return new AnthropicProvider(modelFlag ?? 'claude-sonnet-4-5');
  }
}
