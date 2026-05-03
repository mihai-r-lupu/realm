// realm agent — autonomous CLI command that drives a workflow using an LLM provider.
// Core loop logic lives in packages/cli/src/agent/run-agent.ts for testability.
import { Command } from 'commander';
import { join } from 'node:path';
import {
  loadWorkflowFromFile,
  JsonFileStore,
  JsonWorkflowStore,
  createDefaultRegistry,
  GitHubAdapter,
  SlackAdapter,
} from '@sensigo/realm';
import type { ProviderName } from '../agent/llm-provider.js';
import { resolveProvider } from '../agent/llm-provider.js';
import { runAgent } from '../agent/run-agent.js';
import {
  checkAdapterPrerequisites,
  formatPreflightError,
  checkSlackBidirectionalConfig,
} from '../agent/preflight.js';

export const agentCommand = new Command('agent')
  .description('Run a workflow autonomously using an LLM provider')
  .option('--workflow <path>', 'Path to workflow directory or workflow.yaml file')
  .option('--run-id <id>', 'Attach to an existing run instead of creating a new one')
  .option('--params <json>', 'Initial run parameters as JSON string', '{}')
  .option('--provider <provider>', 'LLM provider: openai or anthropic (auto-detected from env)')
  .option('--model <model>', 'Model name override (default: gpt-4o / claude-sonnet-4-5)')
  .option(
    '--register',
    'Persist the workflow definition to ~/.realm/workflows/ (same as realm workflow register)',
  )
  .action(
    async (opts: {
      workflow?: string;
      runId?: string;
      params: string;
      provider?: string;
      model?: string;
      register?: boolean;
    }) => {
      if (!opts.workflow && !opts.runId) {
        console.error('Error: one of --workflow or --run-id is required');
        process.exit(1);
      }
      if (opts.workflow && opts.runId) {
        console.error('Error: --workflow and --run-id are mutually exclusive');
        process.exit(1);
      }
      if (opts.params !== '{}' && opts.runId) {
        console.error(
          'Error: --params cannot be used with --run-id; the run already has params from creation time',
        );
        process.exit(1);
      }
      try {
        const workflowStore = new JsonWorkflowStore();
        const store = new JsonFileStore();
        const provider = await resolveProvider(
          opts.provider as ProviderName | undefined,
          opts.model,
        );
        const registry = createDefaultRegistry();
        if (process.env['GITHUB_TOKEN'] !== undefined)
          registry.register(
            'adapter',
            'github',
            new GitHubAdapter('github', { auth: { token: process.env['GITHUB_TOKEN'] } }),
          );
        if (process.env['SLACK_WEBHOOK_URL'] !== undefined)
          registry.register(
            'adapter',
            'slack',
            new SlackAdapter('slack', { webhook_url: process.env['SLACK_WEBHOOK_URL'] }),
          );

        let result: import('../agent/run-agent.js').AgentRunResult;

        if (opts.runId !== undefined) {
          // --run-id path: attach to existing run, load definition from store.
          const runRecord = await store.get(opts.runId);
          const definition = await workflowStore.get(runRecord.workflow_id);
          result = await runAgent(
            { store, workflowStore, provider, registry },
            { existingRunId: opts.runId, definition, params: {} },
          );
        } else {
          const params = JSON.parse(opts.params) as Record<string, unknown>;

          // Resolve and load workflow definition before starting a run.
          const inputPath = opts.workflow!;
          const filePath =
            inputPath.endsWith('.yaml') || inputPath.endsWith('.yml')
              ? inputPath
              : join(inputPath, 'workflow.yaml');
          const definition = loadWorkflowFromFile(filePath);

          // Fail fast if required adapter env vars are missing.
          const preflightFindings = checkAdapterPrerequisites(definition);
          if (preflightFindings.length > 0) {
            console.error(formatPreflightError(preflightFindings));
            process.exit(1);
          }

          // Print advisory warnings for incomplete Slack bidirectional config.
          const slackWarnings = checkSlackBidirectionalConfig();
          for (const warning of slackWarnings) {
            console.warn(`  ⚠  ${warning.message}`);
          }

          result = await runAgent(
            { store, workflowStore, provider, registry },
            {
              definition,
              params,
              register: opts.register === true,
              ...(process.env['SLACK_WEBHOOK_URL'] !== undefined && {
                slackWebhookUrl: process.env['SLACK_WEBHOOK_URL'],
              }),
              ...(process.env['SLACK_BOT_TOKEN'] !== undefined && {
                slackBotToken: process.env['SLACK_BOT_TOKEN'],
              }),
              ...(process.env['SLACK_CHANNEL_ID'] !== undefined && {
                slackChannelId: process.env['SLACK_CHANNEL_ID'],
              }),
              ...(process.env['SLACK_SIGNING_SECRET'] !== undefined && {
                slackSigningSecret: process.env['SLACK_SIGNING_SECRET'],
              }),
              ...(process.env['SLACK_EVENTS_PORT'] !== undefined && {
                slackEventsPort: parseInt(process.env['SLACK_EVENTS_PORT'], 10),
              }),
              ...(process.env['SLACK_APP_TOKEN'] !== undefined && {
                slackAppToken: process.env['SLACK_APP_TOKEN'],
              }),
              ...(process.env['SLACK_GATE_REMINDER_INTERVAL_MS'] !== undefined && {
                slackGateReminderIntervalMs: parseInt(
                  process.env['SLACK_GATE_REMINDER_INTERVAL_MS'],
                  10,
                ),
              }),
              ...(process.env['SLACK_GATE_ESCALATION_THRESHOLD_MS'] !== undefined && {
                slackGateEscalationThresholdMs: parseInt(
                  process.env['SLACK_GATE_ESCALATION_THRESHOLD_MS'],
                  10,
                ),
              }),
            },
          );
        }

        process.exit(result === 'completed' ? 0 : 1);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    },
  );
