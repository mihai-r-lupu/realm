// preflight.test.ts — Tests for checkSlackBidirectionalConfig.
import { describe, it, expect } from 'vitest';
import { checkSlackBidirectionalConfig } from './preflight.js';

describe('checkSlackBidirectionalConfig', () => {
  it('returns empty array when no Slack vars are set', () => {
    expect(checkSlackBidirectionalConfig({})).toHaveLength(0);
  });

  it('warns when SLACK_WEBHOOK_URL is set but SLACK_BOT_TOKEN is not', () => {
    const warnings = checkSlackBidirectionalConfig({
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('SLACK_WEBHOOK_URL');
    expect(warnings[0]!.message).toContain('SLACK_BOT_TOKEN');
  });

  it('warns when SLACK_BOT_TOKEN is set but neither SLACK_APP_TOKEN nor SLACK_SIGNING_SECRET is set', () => {
    const warnings = checkSlackBidirectionalConfig({ SLACK_BOT_TOKEN: 'xoxb-test' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('SLACK_BOT_TOKEN');
    expect(warnings[0]!.message).toContain('SLACK_APP_TOKEN');
    expect(warnings[0]!.message).toContain('SLACK_SIGNING_SECRET');
  });

  it('returns no warning when SLACK_BOT_TOKEN + SLACK_APP_TOKEN are set (valid Mode 2)', () => {
    const warnings = checkSlackBidirectionalConfig({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_APP_TOKEN: 'xapp-test',
    });
    expect(warnings).toHaveLength(0);
  });

  it('returns no warning when SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET are set (valid Mode 3)', () => {
    const warnings = checkSlackBidirectionalConfig({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_SIGNING_SECRET: 'secret',
    });
    expect(warnings).toHaveLength(0);
  });

  it('warns when both SLACK_APP_TOKEN and SLACK_SIGNING_SECRET are set', () => {
    const warnings = checkSlackBidirectionalConfig({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_APP_TOKEN: 'xapp-test',
      SLACK_SIGNING_SECRET: 'secret',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('SLACK_APP_TOKEN');
    expect(warnings[0]!.message).toContain('SLACK_SIGNING_SECRET');
    expect(warnings[0]!.message).toContain('Socket Mode');
    expect(warnings[0]!.message).toContain('precedence');
  });
});
