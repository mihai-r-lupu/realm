import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenericHttpAdapter } from './http-adapter.js';
import { WorkflowError } from '../types/workflow-error.js';

type MockFetch = ReturnType<typeof vi.fn>;

function makeMockResponse(status: number, data: unknown, ok: boolean, statusText = 'OK'): Response {
  return {
    ok,
    status,
    statusText,
    json: async () => data,
  } as unknown as Response;
}

describe('GenericHttpAdapter', () => {
  let mockFetch: MockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('fetch() issues a GET with correct URL and query params', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(200, { ok: true }, true));
    const adapter = new GenericHttpAdapter('test', { base_url: 'https://api.example.com' });
    await adapter.fetch('users', { page: '1' }, {});
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/users?');
    expect(url).toContain('page=1');
    expect(opts.method).toBe('GET');
  });

  it('create() issues a POST with JSON body', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(201, { id: 1 }, true));
    const adapter = new GenericHttpAdapter('test', { base_url: 'https://api.example.com' });
    await adapter.create('items', { name: 'test' }, {});
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/items');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toMatchObject({ name: 'test' });
  });

  it('update() issues a PATCH with JSON body', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(200, { id: 1 }, true));
    const adapter = new GenericHttpAdapter('test', { base_url: 'https://api.example.com' });
    await adapter.update('items/1', { name: 'updated' }, {});
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('PATCH');
  });

  it('bearer auth header is added when auth.type === bearer', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(200, {}, true));
    const adapter = new GenericHttpAdapter('test', {
      base_url: 'https://api.example.com',
      auth: { type: 'bearer', token: 'tok_123' },
    });
    await adapter.fetch('resource', {}, {});
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_123');
  });

  it('4xx response throws WorkflowError with code SERVICE_HTTP_4XX', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(404, null, false, 'Not Found'));
    const adapter = new GenericHttpAdapter('test', { base_url: 'https://api.example.com' });
    await expect(adapter.fetch('missing', {}, {})).rejects.toMatchObject({
      code: 'SERVICE_HTTP_4XX',
    });
    await expect(adapter.fetch('missing', {}, {})).rejects.toBeInstanceOf(WorkflowError);
  });

  it('5xx response throws WorkflowError with code SERVICE_HTTP_5XX', async () => {
    mockFetch.mockResolvedValue(makeMockResponse(500, null, false, 'Internal Server Error'));
    const adapter = new GenericHttpAdapter('test', { base_url: 'https://api.example.com' });
    await expect(adapter.fetch('endpoint', {}, {})).rejects.toMatchObject({
      code: 'SERVICE_HTTP_5XX',
      retryable: true,
    });
  });
});
