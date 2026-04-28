// openai-provider.ts — OpenAI LLM provider implementation for realm agent.
// Requires openai >= 4.0.0 as an optional peer dependency (npm install openai).
import type { LlmProvider } from './llm-provider.js';

const SYSTEM_PROMPT_BASE =
  'You are an AI agent executing a step in a structured workflow.\n' +
  'Your task is described below. Respond with a JSON object only — no markdown, no explanation.';

function buildSystemPrompt(inputSchema?: Record<string, unknown>): string {
  if (inputSchema === undefined) return SYSTEM_PROMPT_BASE;
  return `${SYSTEM_PROMPT_BASE}\nThe JSON must conform to this schema: ${JSON.stringify(inputSchema)}`;
}

/**
 * OpenAI LLM provider for realm agent.
 * Uses the Chat Completions API with json_object response format.
 * Retries once if the model returns non-JSON content.
 */
export class OpenAIProvider implements LlmProvider {
  constructor(private readonly model: string) {}

  async callStep(
    prompt: string,
    inputSchema?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Dynamically import openai to keep it an optional peer dependency.
    // Assigning the module specifier to a typed variable via 'string' makes TS
    // treat it as Promise<any>, bypassing static module resolution at build time.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mod: any;
    try {
      const moduleId: string = 'openai';
      mod = await import(moduleId);
    } catch {
      console.error('realm agent requires the openai package. Run: npm install openai');
      process.exit(1);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new (mod.default as new (opts: Record<string, unknown>) => any)({
      apiKey: process.env['OPENAI_API_KEY'],
    });

    const systemPrompt = buildSystemPrompt(inputSchema);
    type Message = { role: 'system' | 'user' | 'assistant'; content: string };
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    const makeRequest = async (msgs: Message[]): Promise<string> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (
        client.chat.completions.create as (opts: Record<string, unknown>) => Promise<any>
      )({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: msgs,
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      return (response.choices[0]?.message?.content as string | undefined) ?? '';
    };

    const content = await makeRequest(messages);
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      // Retry once with an explicit reminder to return JSON.
      const retryMessages: Message[] = [
        ...messages,
        { role: 'assistant', content },
        {
          role: 'user',
          content: 'Your previous response was not valid JSON. Respond with a JSON object only.',
        },
      ];
      const retry = await makeRequest(retryMessages);
      try {
        return JSON.parse(retry) as Record<string, unknown>;
      } catch {
        throw new Error(`OpenAI returned non-JSON content after retry: ${retry.slice(0, 200)}`);
      }
    }
  }
}
