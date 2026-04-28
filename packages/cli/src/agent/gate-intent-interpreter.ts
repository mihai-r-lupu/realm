// gate-intent-interpreter.ts — Interprets a Slack message as a gate choice using the LLM.
import type { LlmProvider } from './llm-provider.js';

/** Structured output from LLM interpretation of a gate reply. */
export interface GateInterpretation {
  /** One of the allowed gate choices, or 'unclear' when intent cannot be determined. */
  choice: string | 'unclear';
  /** Confidence in the interpretation. */
  confidence: 'high' | 'medium' | 'low';
  /** Brief explanation of the interpretation reasoning. */
  reason: string;
}

export interface InterpretGateIntentOptions {
  /** Raw message text from the Slack thread. */
  userMessage: string;
  /** The gate's valid choices (e.g. ['send', 'reject']). */
  allowedChoices: string[];
  /** Name of the gate step for context. */
  gateStepName: string;
  /** Optional headline from the gate preview — provides brief context without overwhelming the prompt. */
  previewSummary?: string;
  /** LLM provider to use — same instance configured for the agent run. */
  llmClient: LlmProvider;
}

/**
 * Asks the LLM to interpret a human's Slack reply as one of the allowed gate choices.
 * Returns a structured interpretation with confidence level and reasoning.
 * The LLM is solely responsible for understanding intent — no hardcoded synonyms.
 */
export async function interpretGateIntent(
  options: InterpretGateIntentOptions,
): Promise<GateInterpretation> {
  const { userMessage, allowedChoices, gateStepName, previewSummary, llmClient } = options;

  const contextLine = previewSummary !== undefined ? `\nGate context: ${previewSummary}` : '';
  const choiceList = allowedChoices.map((c) => `"${c}"`).join(', ');

  const prompt =
    `You are interpreting a Slack message from a human reviewer responding to a workflow gate.\n` +
    `Gate step: "${gateStepName}"${contextLine}\n` +
    `Allowed choices: ${allowedChoices.join(', ')}\n\n` +
    `Message: "${userMessage}"\n\n` +
    `Determine which choice the user intends. Return JSON with:\n` +
    `- "choice": one of [${choiceList}, "unclear"]\n` +
    `- "confidence": "high", "medium", or "low"\n` +
    `- "reason": brief explanation of your interpretation`;

  const schema = {
    type: 'object',
    required: ['choice', 'confidence', 'reason'],
    properties: {
      choice: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      reason: { type: 'string' },
    },
  };

  const result = await llmClient.callStep(prompt, schema);

  const choice = (result['choice'] as string | undefined) ?? 'unclear';
  const confidence = (result['confidence'] as 'high' | 'medium' | 'low' | undefined) ?? 'low';
  const reason = (result['reason'] as string | undefined) ?? '';

  return { choice, confidence, reason };
}
