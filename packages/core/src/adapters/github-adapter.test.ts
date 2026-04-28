import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GitHubAdapter } from './github-adapter.js';
import { WorkflowError } from '../types/workflow-error.js';
import { startGitHubMockServer } from '@sensigo/realm-testing';
import type { GitHubMockServerHandle } from '@sensigo/realm-testing';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.resolve(
  fileURLToPath(import.meta.url),
  '../fixtures/github-fixture-data.json',
);

describe('GitHubAdapter', () => {
  let handle: GitHubMockServerHandle;
  let adapter: GitHubAdapter;

  beforeAll(async () => {
    handle = await startGitHubMockServer(fixturePath);
    adapter = new GitHubAdapter('test', { base_url: handle.url, auth: { token: 'test-token' } });
  });

  afterAll(async () => {
    await handle.close();
  });

  it('get_pr_diff returns correct shape', async () => {
    const result = await adapter.fetch('get_pr_diff', { repo: 'owner/repo', pr_number: '1' }, {});
    expect(result.status).toBe(200);
    const data = result.data as Record<string, unknown>;
    expect(typeof data['diff_text']).toBe('string');
    expect(data['pr_title']).toBe('Add new feature');
    expect(data['base_branch']).toBe('main');
    expect(Array.isArray(data['files_changed'])).toBe(true);
    expect((data['files_changed'] as unknown[]).length).toBe(2);
  });

  it('get_linked_issues returns correct shape', async () => {
    const result = await adapter.fetch(
      'get_linked_issues',
      { repo: 'owner/repo', pr_number: '1' },
      {},
    );
    expect(result.status).toBe(200);
    const data = result.data as Record<string, unknown>;
    const issues = data['issues'] as Array<Record<string, unknown>>;
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBe(1);
    const issue = issues[0] as Record<string, unknown>;
    expect(issue['number']).toBe(42);
    expect(issue['state']).toBe('open');
  });

  it('set_pr_description echoes the written body', async () => {
    const result = await adapter.update(
      'set_pr_description',
      { repo: 'owner/repo', pr_number: '1', body: 'My new description' },
      {},
    );
    expect(result.status).toBe(200);
    const data = result.data as Record<string, unknown>;
    expect(data['ok']).toBe(true);
    expect(data['body']).toBe('My new description');
  });

  it('Authorization header is sent', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      await adapter.fetch('get_pr_diff', { repo: 'owner/repo', pr_number: '1' }, {});
      expect(spy).toHaveBeenCalledOnce();
      const [, opts] = spy.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-token');
    } finally {
      spy.mockRestore();
    }
  });

  it('unknown fetch operation throws WorkflowError with ENGINE_ADAPTER_FAILED', async () => {
    await expect(adapter.fetch('nonexistent_op', {}, {})).rejects.toMatchObject({
      code: 'ENGINE_ADAPTER_FAILED',
    });
    await expect(adapter.fetch('nonexistent_op', {}, {})).rejects.toBeInstanceOf(WorkflowError);
  });

  it('create throws WorkflowError', async () => {
    await expect(adapter.create('anything', {}, {})).rejects.toBeInstanceOf(WorkflowError);
  });

  it('AbortSignal: aborted before call throws STEP_ABORTED', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.fetch('get_pr_diff', { repo: 'owner/repo', pr_number: '1' }, {}, controller.signal),
    ).rejects.toMatchObject({ code: 'STEP_ABORTED' });
  });
});

describe('GitHubAdapter 404 enrichment', () => {
  it('enriches a 404 response with actionable diagnostic message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }),
    );
    const adapter = new GitHubAdapter('test', { auth: { token: 'token' } });
    try {
      await adapter.fetch('get_pr_diff', { repo: 'owner/repo', pr_number: 42 }, {});
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      const we = err as WorkflowError;
      expect(we.code).toBe('SERVICE_HTTP_4XX');
      expect(we.message).toContain('owner/repo');
      expect(we.message).toContain('42');
      expect(we.message).toContain('private');
      expect(we.message).toContain('gh pr view');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('enriches a 404 on get_linked_issues with actionable diagnostic message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }),
    );
    const adapter = new GitHubAdapter('test', { auth: { token: 'token' } });
    try {
      await adapter.fetch('get_linked_issues', { repo: 'owner/repo', pr_number: 42 }, {});
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      const we = err as WorkflowError;
      expect(we.code).toBe('SERVICE_HTTP_4XX');
      expect(we.message).toContain('owner/repo');
      expect(we.message).toContain('42');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
