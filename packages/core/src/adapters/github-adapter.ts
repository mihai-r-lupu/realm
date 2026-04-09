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
 * GitHubAdapter communicates with the GitHub REST API.
 *
 * Supported operations:
 *   fetch('get_pr_diff', { repo, pr_number })       — GET /repos/{repo}/pulls/{pr_number}/files
 *   fetch('get_linked_issues', { repo, pr_number }) — GET /repos/{repo}/issues?pr={pr_number}
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
    method: 'GET' | 'PATCH',
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
      const result = await this.executeRequest('GET', url, undefined, signal);
      return { ...result, data: { ...(result.data as Record<string, unknown>), repo } };
    }

    if (operation === 'get_linked_issues') {
      const url = `${this.baseUrl}/repos/${repo}/issues?pr=${prNumber}`;
      return this.executeRequest('GET', url, undefined, signal);
    }

    throw new WorkflowError(`GitHubAdapter: unknown operation: ${operation}`, {
      code: 'ENGINE_ADAPTER_FAILED',
      category: 'ENGINE',
      agentAction: 'stop',
      retryable: false,
    });
  }

  async create(
    _operation: string,
    _params: Record<string, unknown>,
    _config: Record<string, unknown>,
    _signal?: AbortSignal,
  ): Promise<ServiceResponse> {
    throw new WorkflowError('GitHubAdapter: unsupported operation: create', {
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
