// realm agent — autonomous CLI command that drives a workflow using an LLM provider.
// Core loop logic lives in packages/cli/src/agent/run-agent.ts for testability.
import { Command } from 'commander';
import {
  JsonFileStore,
  JsonWorkflowStore,
  createDefaultRegistry,
  GitHubAdapter,
  SlackAdapter,
} from '@sensigo/realm';
import type { ProviderName } from '../agent/llm-provider.js';
import { resolveProvider } from '../agent/llm-provider.js';
import { runAgent } from '../agent/run-agent.js';

export const agentCommand = new Command('agent')
  .description('Run a workflow autonomously using an LLM provider')
  .requiredOption('--workflow <path>', 'Path to workflow directory or workflow.yaml file')
  .option('--params <json>', 'Initial run parameters as JSON string', '{}')
  .option('--provider <provider>', 'LLM provider: openai or anthropic (auto-detected from env)')
  .option('--model <model>', 'Model name override (default: gpt-4o / claude-sonnet-4-5)')
  .action(async (opts: { workflow: string; params: string; provider?: string; model?: string }) => {
    try {
      const params = JSON.parse(opts.params) as Record<string, unknown>;
      const workflowStore = new JsonWorkflowStore();
      const store = new JsonFileStore();
      const provider = await resolveProvider(opts.provider as ProviderName | undefined, opts.model);
      const registry = createDefaultRegistry();
      if (process.env['GITHUB_TOKEN'] !== undefined)
        registry.register('adapter', 'github', new GitHubAdapter('github', { auth: { token: process.env['GITHUB_TOKEN'] } }));
      if (process.env['SLACK_WEBHOOK_URL'] !== undefined)
        registry.register('adapter', 'slack', new SlackAdapter('slack', { webhook_url: process.env['SLACK_WEBHOOK_URL'] }));
      const result = await runAgent(
        { store, workflowStore, provider, registry },
        {
          workflowPath: opts.workflow,
          params,
          ...(process.env['SLACK_WEBHOOK_URL'] !== undefined && { slackWebhookUrl: process.env['SLACK_WEBHOOK_URL'] }),
        },
      );
      process.exit(result === 'completed' ? 0 : 1);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
