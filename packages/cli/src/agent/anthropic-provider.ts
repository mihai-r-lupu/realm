// anthropic-provider.ts — Anthropic LLM provider implementation for realm agent.
// Requires @anthropic-ai/sdk >= 0.20.0 as an optional peer dependency (npm install @anthropic-ai/sdk).
import type { LlmProvider } from './llm-provider.js';

const SYSTEM_PROMPT_BASE =
  'You are an AI agent executing a step in a structured workflow.\n' +
  'Your task is described below. Respond with a JSON object only — no markdown, no explanation.';

function buildSystemPrompt(inputSchema?: Record<string, unknown>): string {
  if (inputSchema === undefined) return SYSTEM_PROMPT_BASE;
  return `${SYSTEM_PROMPT_BASE}\nThe JSON must conform to this schema: ${JSON.stringify(inputSchema)}`;
}

/**
 * Anthropic LLM provider for realm agent.
 * Uses the Messages API and extracts JSON from the first text content block.
 * Retries once if the model returns non-JSON content.
 */
export class AnthropicProvider implements LlmProvider {
  constructor(private readonly model: string) {}

  async callStep(
    prompt: string,
    inputSchema?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Dynamically import @anthropic-ai/sdk to keep it an optional peer dependency.
    // See openai-provider.ts for an explanation of the 'string' cast technique.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mod: any;
    try {
      const moduleId: string = '@anthropic-ai/sdk';
      mod = await import(moduleId);
    } catch {
      console.error(
        'realm agent requires the @anthropic-ai/sdk package. Run: npm install @anthropic-ai/sdk',
      );
      process.exit(1);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new (mod.default as new (opts: Record<string, unknown>) => any)({
      apiKey: process.env['ANTHROPIC_API_KEY'],
    });

    const systemPrompt = buildSystemPrompt(inputSchema);

    const makeRequest = async (userContent: string): Promise<string> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (
        client.messages.create as (opts: Record<string, unknown>) => Promise<any>
      )({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      const block = (response.content as unknown[]).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (b: any) => (b as { type?: string }).type === 'text',
      ) as { text?: string } | undefined;
      return block?.text ?? '';
    };

    const content = await makeRequest(prompt);
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      // Retry once with an explicit reminder to return JSON.
      const retryPrompt = `${prompt}\n\nYour previous response was not valid JSON. Respond with a JSON object only.`;
      const retry = await makeRequest(retryPrompt);
      try {
        return JSON.parse(retry) as Record<string, unknown>;
      } catch {
        throw new Error(`Anthropic returned non-JSON content after retry: ${retry.slice(0, 200)}`);
      }
    }
  }
}
