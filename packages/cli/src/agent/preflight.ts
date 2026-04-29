// preflight.ts — Adapter prerequisite checker for realm agent.
// Pure functions with no side effects — all checks are injected via the env parameter.
import type { WorkflowDefinition } from '@sensigo/realm';

/** Maps adapter name to the env var it requires. */
const ADAPTER_ENV_REQS: Record<string, { envVar: string; exportExample: string }> = {
  github: {
    envVar: 'GITHUB_TOKEN',
    exportExample: 'export GITHUB_TOKEN=ghp_...',
  },
  slack: {
    envVar: 'SLACK_WEBHOOK_URL',
    exportExample: 'export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...',
  },
};

export interface PreflightFinding {
  /** Service name from the workflow definition. */
  serviceName: string;
  /** Adapter name (e.g. 'github', 'slack'). */
  adapter: string;
  /** Name of the missing environment variable. */
  missingVar: string;
  /** Ready-to-paste export command for the missing variable. */
  exportExample: string;
}

/**
 * Inspects the workflow's `services` block and returns a finding for each
 * built-in adapter whose required environment variable is absent from env.
 * Returns an empty array when all prerequisites are satisfied.
 */
export function checkAdapterPrerequisites(
  definition: WorkflowDefinition,
  env: NodeJS.ProcessEnv = process.env,
): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const [serviceName, serviceDef] of Object.entries(definition.services ?? {})) {
    const req = ADAPTER_ENV_REQS[serviceDef.adapter];
    if (req === undefined) continue;
    if (env[req.envVar] === undefined) {
      findings.push({
        serviceName,
        adapter: serviceDef.adapter,
        missingVar: req.envVar,
        exportExample: req.exportExample,
      });
    }
  }
  return findings;
}

/**
 * Formats preflight findings into a multi-line actionable error message.
 * Does not include secrets or values — only variable names and export examples.
 */
export function formatPreflightError(findings: PreflightFinding[]): string {
  const lines = ['Error: Missing required environment variables for workflow services:'];
  for (const f of findings) {
    lines.push(`  - service '${f.serviceName}' (adapter '${f.adapter}'): ${f.missingVar}`);
  }
  lines.push('', 'Set and retry:');
  for (const f of findings) {
    lines.push(`  ${f.exportExample}`);
  }
  return lines.join('\n');
}

/** An advisory (non-blocking) Slack configuration warning. */
export interface PreflightWarning {
  message: string;
}

/**
 * Checks for incomplete Slack bidirectional configuration and returns advisory warnings.
 * These are non-blocking — the run proceeds but with degraded Slack functionality.
 *
 * Bidirectional resolution requires SLACK_BOT_TOKEN + SLACK_CHANNEL_ID and at least one of:
 * - SLACK_APP_TOKEN (Socket Mode — WebSocket push, no public URL required)
 * - SLACK_SIGNING_SECRET (Events API — HTTP push, requires public URL)
 */
export function checkSlackBidirectionalConfig(
  env: NodeJS.ProcessEnv = process.env,
): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];

  if (env['SLACK_WEBHOOK_URL'] !== undefined && env['SLACK_BOT_TOKEN'] === undefined) {
    warnings.push({
      message:
        'SLACK_WEBHOOK_URL is set but SLACK_BOT_TOKEN is not. Gate replies cannot be received from Slack — approval requires the terminal command.',
    });
  }

  if (
    env['SLACK_BOT_TOKEN'] !== undefined &&
    env['SLACK_APP_TOKEN'] === undefined &&
    env['SLACK_SIGNING_SECRET'] === undefined
  ) {
    warnings.push({
      message:
        'SLACK_BOT_TOKEN is set but neither SLACK_APP_TOKEN nor SLACK_SIGNING_SECRET is set. ' +
        'Gate replies cannot be resolved automatically from Slack — set SLACK_APP_TOKEN (Socket Mode, recommended) ' +
        'or SLACK_SIGNING_SECRET (Events API) to enable automatic resolution.',
    });
  }

  if (env['SLACK_APP_TOKEN'] !== undefined && env['SLACK_SIGNING_SECRET'] !== undefined) {
    warnings.push({
      message:
        'Both SLACK_APP_TOKEN and SLACK_SIGNING_SECRET are set — Socket Mode (Mode 2) takes precedence. ' +
        'Remove SLACK_APP_TOKEN to use Events API (Mode 3).',
    });
  }

  return warnings;
}
