// gate-intent-interpreter.test.ts — Tests for the LLM-based gate intent interpreter.
import { describe, it, expect, vi } from 'vitest';
import { interpretGateIntent } from './gate-intent-interpreter.js';
import type { LlmProvider } from './llm-provider.js';

function makeMockProvider(returnValue: Record<string, unknown>): LlmProvider {
  return { callStep: vi.fn().mockResolvedValue(returnValue) };
}

describe('interpretGateIntent', () => {
  it('returns the LLM choice when confidence is high', async () => {
    const provider = makeMockProvider({ choice: 'approve', confidence: 'high', reason: 'User said approve' });

    const result = await interpretGateIntent({
      llmClient: provider,
      gateStepName: 'deploy_production',
      allowedChoices: ['approve', 'reject'],
      previewSummary: 'Deploy v2.0 to production',
      userMessage: 'approve',
    });

    expect(result.choice).toBe('approve');
    expect(result.confidence).toBe('high');
    expect(result.reason).toBe('User said approve');
  });

  it('returns unclear when LLM returns unclear', async () => {
    const provider = makeMockProvider({ choice: 'unclear', confidence: 'low', reason: 'Cannot determine intent' });

    const result = await interpretGateIntent({
      llmClient: provider,
      gateStepName: 'deploy_production',
      allowedChoices: ['approve', 'reject'],
      previewSummary: 'Deploy v2.0 to production',
      userMessage: 'hmm not sure yet',
    });

    expect(result.choice).toBe('unclear');
    expect(result.confidence).toBe('low');
  });

  it('sends a prompt containing stepName, userMessage, and allowedChoices', async () => {
    const mockCallStep = vi.fn().mockResolvedValue({ choice: 'reject', confidence: 'high', reason: 'No' });
    const provider: LlmProvider = { callStep: mockCallStep };

    await interpretGateIntent({
      llmClient: provider,
      gateStepName: 'deploy_production',
      allowedChoices: ['approve', 'reject'],
      previewSummary: 'Deploy v2.0 to production',
      userMessage: 'do not deploy',
    });

    const [prompt] = mockCallStep.mock.calls[0] as [string, unknown];
    expect(prompt).toContain('deploy_production');
    expect(prompt).toContain('do not deploy');
    expect(prompt).toContain('approve');
    expect(prompt).toContain('reject');
  });

  it('returns low confidence structure when LLM returns low confidence', async () => {
    const provider = makeMockProvider({ choice: 'approve', confidence: 'low', reason: 'Uncertain' });

    const result = await interpretGateIntent({
      llmClient: provider,
      gateStepName: 'merge_pr',
      allowedChoices: ['approve', 'reject'],
      previewSummary: 'PR #42 ready to merge',
      userMessage: 'maybe',
    });

    expect(result.confidence).toBe('low');
    expect(result.reason).toBe('Uncertain');
  });
});
