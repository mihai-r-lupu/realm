// GitHubAdapter — communicates with the GitHub REST API.
import { WorkflowError } from '../types/workflow-error.js';
import type { ServiceAdapter, ServiceResponse } from '../extensions/service-adapter.js';

/**
 * Configuration for GitHubAdapter.
 * `base_url` defaults to "https://api.github.com" and can be overridden for testing.
 */
export interface GitHubAdapterConfig {
  /** Defaults to "https://api.github.com". Override in tests to point at a mock server. */
  base_url?: string;
  auth?: {
    token: string;
  };
}

/**
 * Rewraps a `SERVICE_HTTP_4XX` 404 WorkflowError with an actionable diagnostic message.
 * Returns the original error unchanged for any other error type or status code.
 * Does not log or expose token values.
 *
 * @param mode - `'pr'` renders `gh pr view`; `'issue'` renders `gh issue view`. Defaults to `'pr'`.
 */
function enrichGitHub404(
  err: unknown,
  repo: string | undefined,
  number: unknown,
  mode: 'pr' | 'issue' = 'pr',
): unknown {
  if (
    err instanceof WorkflowError &&
    err.code === 'SERVICE_HTTP_4XX' &&
    err.details['status'] === 404
  ) {
    const noun = mode === 'issue' ? 'Issue' : 'PR';
    const ghCmd =
      mode === 'issue'
        ? `gh issue view ${number} --repo ${repo ?? '<repo>'}`
        : `gh pr view ${number} --repo ${repo ?? '<repo>'}`;
    return new WorkflowError(
      `HTTP 404: Resource not found.\n\n` +
        `Likely causes:\n` +
        `  - Repository '${repo ?? '<repo>'}' or ${noun} #${number} does not exist\n` +
        `  - GITHUB_TOKEN does not have access to this repository (private repos return 404)\n\n` +
        `Verify with:\n` +
        `  ${ghCmd}`,
      {
        code: 'SERVICE_HTTP_4XX',
        category: 'SERVICE',
        agentAction: 'stop',
        retryable: false,
        details: err.details,
      },
    );
  }
  return err;
}

/**
 * GitHubAdapter communicates with the GitHub REST API.
 *
 * Supported operations:
 *   fetch('get_pr_diff', { repo, pr_number })              — GET  /repos/{repo}/pulls/{pr_number}/files
 *   fetch('get_linked_issues', { repo, pr_number })        — GET  /repos/{repo}/issues?pr={pr_number}
 *   fetch('get_issue', { repo, issue_number })             — GET  /repos/{repo}/issues/{issue_number}
 *   create('post_comment', { repo, issue_number, body })   — POST /repos/{repo}/issues/{issue_number}/comments
 *   create('apply_labels', { repo, issue_number, labels }) — POST /repos/{repo}/issues/{issue_number}/labels
 *   update('set_pr_description', { repo, pr_number, body }) — PATCH /repos/{repo}/pulls/{pr_number}
 */
export class GitHubAdapter implements ServiceAdapter {
  readonly id: string;
  private readonly baseUrl: string;

  constructor(
    id: string,
    private readonly config: GitHubAdapterConfig = {},
  ) {
    this.id = id;
    this.baseUrl = config.base_url ?? 'https://api.github.com';
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.config.auth?.token !== undefined) {
      headers['Authorization'] = `Bearer ${this.config.auth.token}`;
    }
    return headers;
  }

  private checkAborted(signal?: AbortSignal): void {
    if (signal?.aborted === true) {
      throw new WorkflowError('Adapter request aborted', {
        code: 'STEP_ABORTED',
        category: 'ENGINE',
        agentAction: 'report_to_user',
        retryable: false,
      });
    }
  }

  private async executeRequest(
    method: 'GET' | 'PATCH' | 'POST',
    url: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<ServiceResponse> {
    const fetchOptions: RequestInit =
      method === 'GET'
        ? { method, headers: this.buildHeaders(), signal: signal ?? null }
        : {
            method,
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: signal ?? null,
          };

    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new WorkflowError('Adapter request aborted', {
          code: 'STEP_ABORTED',
          category: 'ENGINE',
          agentAction: 'report_to_user',
          retryable: false,
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new WorkflowError(message, {
        code: 'NETWORK_UNREACHABLE',
        category: 'NETWORK',
        agentAction: 'wait_for_human',
        retryable: true,
      });
    }

    if (!response.ok) {
      const status = response.status;
      throw new WorkflowError(`HTTP ${status}: ${response.statusText}`, {
        code: status >= 500 ? 'SERVICE_HTTP_5XX' : 'SERVICE_HTTP_4XX',
        category: 'SERVICE',
        agentAction: status >= 500 ? 'report_to_user' : 'stop',
        retryable: status >= 500,
        details: { status, operation: url },
      });
    }

    const data: unknown = await response.json();
    return { status: response.status, data };
  }

  async fetch(
    operation: string,
    params: Record<string, unknown>,
    _config: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ServiceResponse> {
    this.checkAborted(signal);

    const repo = params['repo'] as string;
    const prNumber = params['pr_number'];

    if (operation === 'get_pr_diff') {
      const url = `${this.baseUrl}/repos/${repo}/pulls/${prNumber}/files`;
      try {
        const result = await this.executeRequest('GET', url, undefined, signal);
        return { ...result, data: { ...(result.data as Record<string, unknown>), repo } };
      } catch (err) {
        throw enrichGitHub404(err, repo, prNumber);
      }
    }

    if (operation === 'get_linked_issues') {
      const url = `${this.baseUrl}/repos/${repo}/issues?pr=${prNumber}`;
      try {
        return await this.executeRequest('GET', url, undefined, signal);
      } catch (err) {
        throw enrichGitHub404(err, repo, prNumber);
      }
    }

    if (operation === 'get_issue') {
      const issueNumber = params['issue_number'];
      const url = `${this.baseUrl}/repos/${repo}/issues/${issueNumber}`;
      try {
        return await this.executeRequest('GET', url, undefined, signal);
      } catch (err) {
        throw enrichGitHub404(err, repo, issueNumber, 'issue');
      }
    }

    throw new WorkflowError(`GitHubAdapter: unknown operation: ${operation}`, {
      code: 'ENGINE_ADAPTER_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
  }

  async create(
    operation: string,
    params: Record<string, unknown>,
    _config: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ServiceResponse> {
    this.checkAborted(signal);

    const repo = params['repo'] as string;
    const issueNumber = params['issue_number'];

    if (operation === 'post_comment') {
      const body = params['body'];
      const url = `${this.baseUrl}/repos/${repo}/issues/${issueNumber}/comments`;
      return this.executeRequest('POST', url, { body }, signal);
    }

    if (operation === 'apply_labels') {
      const labels = params['labels'];
      const url = `${this.baseUrl}/repos/${repo}/issues/${issueNumber}/labels`;
      return this.executeRequest('POST', url, { labels }, signal);
    }

    throw new WorkflowError(`GitHubAdapter: unknown operation: ${operation}`, {
      code: 'ENGINE_ADAPTER_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
  }

  async update(
    operation: string,
    params: Record<string, unknown>,
    _config: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ServiceResponse> {
    this.checkAborted(signal);

    if (operation === 'set_pr_description') {
      const repo = params['repo'] as string;
      const prNumber = params['pr_number'];
      const body = params['body'];
      const url = `${this.baseUrl}/repos/${repo}/pulls/${prNumber}`;
      const result = await this.executeRequest('PATCH', url, { body }, signal);
      const raw = result.data as Record<string, unknown>;
      return { status: result.status, data: { ok: true, body: raw['body'] } };
    }

    throw new WorkflowError(`GitHubAdapter: unknown operation: ${operation}`, {
      code: 'ENGINE_ADAPTER_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
  }
}
