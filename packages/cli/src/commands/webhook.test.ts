// Tests for realm webhook: signature verification, event filtering, deduplication,
// run creation, child spawning, startup validation, payload mapping, and CLI guards.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { InMemoryStore } from '@sensigo/realm-testing';
import { CURRENT_WORKFLOW_SCHEMA_VERSION } from '@sensigo/realm';
import type { WorkflowDefinition, WorkflowRegistrar } from '@sensigo/realm';
import {
  checkWebhookSignature,
  isDuplicate,
  startWebhookServer,
  webhookCommand,
} from './webhook.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'test-webhook-secret';
const EVENTS = [{ event: 'pull_request', action: 'opened' }];

const testWorkflow: WorkflowDefinition = {
  id: 'pr-reviewer',
  name: 'PR Reviewer',
  version: 1,
  schema_version: CURRENT_WORKFLOW_SCHEMA_VERSION,
  steps: {
    review: {
      execution: 'agent',
      description: 'Review the PR',
    },
  },
};

const testPayload = {
  action: 'opened',
  pull_request: {
    number: 42,
    html_url: 'https://github.com/org/repo/pull/42',
    title: 'Test PR title',
    base: { sha: 'base_sha_abc123' },
    head: { sha: 'head_sha_def456' },
  },
  repository: {
    name: 'repo',
    owner: { login: 'org' },
  },
  sender: { login: 'testuser' },
};

/**
 * Computes the GitHub-style HMAC-SHA256 signature for a body string.
 * Used in tests to generate valid signatures matching the server's expectations.
 */
function sign(body: string, secret: string = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

function makeMockChild() {
  return { unref: vi.fn(), pid: 12345 };
}

function makeMockWorkflowStore(): WorkflowRegistrar {
  return {
    async register() {},
    async get() {
      throw new Error('not used');
    },
    async list() {
      return [];
    },
  };
}

/** Starts a test webhook server on a random OS-assigned port. */
async function startTestServer(opts: {
  events?: typeof EVENTS;
  provider?: string;
  model?: string;
  runStore?: InMemoryStore;
  spawnFn?: ReturnType<typeof vi.fn>;
}): Promise<{ server: Server; url: string; mockSpawn: ReturnType<typeof vi.fn> }> {
  const mockSpawn = opts.spawnFn ?? vi.fn().mockReturnValue(makeMockChild());
  const server = await startWebhookServer({
    port: 0,
    secret: SECRET,
    definition: testWorkflow,
    events: opts.events ?? EVENTS,
    runStore: opts.runStore ?? new InMemoryStore(),
    workflowStore: makeMockWorkflowStore(),
    spawnFn: mockSpawn as Parameters<typeof startWebhookServer>[0]['spawnFn'],
    ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
  });
  const addr = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${addr.port}`, mockSpawn };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

/** Sends a signed webhook POST to the server. */
async function postWebhook(
  url: string,
  opts: {
    body?: object;
    deliveryId?: string;
    event?: string;
    signature?: string;
    noSignature?: boolean;
  } = {},
): Promise<Response> {
  const body = JSON.stringify(opts.body ?? testPayload);
  const sig = opts.noSignature ? undefined : (opts.signature ?? sign(body));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Github-Event': opts.event ?? 'pull_request',
    'X-Github-Delivery': opts.deliveryId ?? 'delivery-001',
  };
  if (sig !== undefined) headers['X-Hub-Signature-256'] = sig;
  return fetch(url, { method: 'POST', headers, body });
}

// ---------------------------------------------------------------------------
// checkWebhookSignature — pure unit tests
// ---------------------------------------------------------------------------

describe('checkWebhookSignature', () => {
  it('returns true for a correct HMAC', () => {
    const body = Buffer.from('hello world');
    const sig = 'sha256=' + createHmac('sha256', 'mysecret').update(body).digest('hex');
    expect(checkWebhookSignature(body, sig, 'mysecret')).toBe(true);
  });

  it('returns false for a wrong HMAC', () => {
    const body = Buffer.from('hello world');
    const sig = 'sha256=' + 'a'.repeat(64);
    expect(checkWebhookSignature(body, sig, 'mysecret')).toBe(false);
  });

  it('returns false when header is undefined', () => {
    expect(checkWebhookSignature(Buffer.from('x'), undefined, 'mysecret')).toBe(false);
  });

  it('returns false when body differs from what was signed', () => {
    const body = Buffer.from('original');
    const sig = 'sha256=' + createHmac('sha256', 'mysecret').update(body).digest('hex');
    expect(checkWebhookSignature(Buffer.from('tampered'), sig, 'mysecret')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDuplicate — cache eviction test
// ---------------------------------------------------------------------------

describe('isDuplicate', () => {
  it('evicts the oldest entry when cache reaches 1000 entries', () => {
    const cache = new Map<string, number>();
    // Fill cache to exactly 1000 with staggered timestamps to ensure ordering
    let now = Date.now();
    // delivery-0 is oldest — added first
    cache.set('delivery-0', now++);
    for (let i = 1; i < 1000; i++) {
      cache.set(`delivery-${i}`, now++);
    }
    expect(cache.size).toBe(1000);
    // Adding entry 1001 must evict delivery-0 (the oldest)
    isDuplicate(cache, 'delivery-1001');
    expect(cache.has('delivery-0')).toBe(false);
    expect(cache.size).toBe(1000);
  });

  it('returns false for a new delivery and adds it to the cache', () => {
    const cache = new Map<string, number>();
    expect(isDuplicate(cache, 'new-delivery')).toBe(false);
    expect(cache.has('new-delivery')).toBe(true);
  });

  it('returns true for a delivery already in the cache within TTL', () => {
    const cache = new Map<string, number>();
    isDuplicate(cache, 'dup');
    expect(isDuplicate(cache, 'dup')).toBe(true);
  });

  it('returns false (not a duplicate) for the same delivery ID after TTL expires', () => {
    vi.useFakeTimers();
    const cache = new Map<string, number>();
    isDuplicate(cache, 'ttl-test'); // first call — adds to cache
    expect(isDuplicate(cache, 'ttl-test')).toBe(true); // within TTL — duplicate
    vi.advanceTimersByTime(11 * 60 * 1000); // advance past 10-minute TTL
    expect(isDuplicate(cache, 'ttl-test')).toBe(false); // expired — not a duplicate
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// startWebhookServer — HTTP handler integration tests
// ---------------------------------------------------------------------------

describe('startWebhookServer — HTTP handler', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
  });

  it('returns 202 and spawns child for valid signature + matching event + action', async () => {
    const runStore = new InMemoryStore();
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ runStore, spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    const res = await postWebhook(`http://127.0.0.1:${addr.port}`);

    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; run_id: string };
    expect(body.ok).toBe(true);
    expect(typeof body.run_id).toBe('string');
    expect(mockSpawn).toHaveBeenCalledOnce();
    // Verify a run was created
    const runs = await runStore.list(testWorkflow.id);
    expect(runs.length).toBe(1);
  });

  it('returns 403 when X-Hub-Signature-256 header is missing', async () => {
    ({ server } = await startTestServer({}));
    const addr = server.address() as { port: number };

    const res = await postWebhook(`http://127.0.0.1:${addr.port}`, { noSignature: true });

    expect(res.status).toBe(403);
  });

  it('returns 403 when signature is invalid', async () => {
    ({ server } = await startTestServer({}));
    const addr = server.address() as { port: number };

    const res = await postWebhook(`http://127.0.0.1:${addr.port}`, {
      signature: 'sha256=' + 'b'.repeat(64),
    });

    expect(res.status).toBe(403);
  });

  it('returns 403 for invalid signature even when event does not match (HMAC checked first)', async () => {
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    const res = await postWebhook(`http://127.0.0.1:${addr.port}`, {
      event: 'push',
      signature: 'sha256=' + 'c'.repeat(64),
    });

    expect(res.status).toBe(403);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns 200 and no run when event type does not match filter', async () => {
    const runStore = new InMemoryStore();
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ runStore, spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    const body = JSON.stringify({ ...testPayload });
    const res = await postWebhook(`http://127.0.0.1:${addr.port}`, {
      event: 'push',
      signature: sign(body),
      body: testPayload,
    });

    expect(res.status).toBe(200);
    expect(mockSpawn).not.toHaveBeenCalled();
    const runs = await runStore.list({ workflowId: testWorkflow.id });
    expect(runs.length).toBe(0);
  });

  it('returns 200 and no run when payload action does not match filter', async () => {
    const runStore = new InMemoryStore();
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ runStore, spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    const syncedPayload = { ...testPayload, action: 'synchronize' };
    const body = JSON.stringify(syncedPayload);
    const res = await postWebhook(`http://127.0.0.1:${addr.port}`, {
      signature: sign(body),
      body: syncedPayload,
    });

    expect(res.status).toBe(200);
    expect(mockSpawn).not.toHaveBeenCalled();
    const runs = await runStore.list({ workflowId: testWorkflow.id });
    expect(runs.length).toBe(0);
  });

  it('returns 200 for duplicate delivery ID within TTL', async () => {
    const runStore = new InMemoryStore();
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ runStore, spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    // First request — should succeed
    const res1 = await postWebhook(`http://127.0.0.1:${addr.port}`, {
      deliveryId: 'dup-delivery-abc',
    });
    expect(res1.status).toBe(202);

    // Second request with same delivery ID — should be deduplicated
    const res2 = await postWebhook(`http://127.0.0.1:${addr.port}`, {
      deliveryId: 'dup-delivery-abc',
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { skipped: string };
    expect(body2.skipped).toBe('duplicate');
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it('extracts and maps all ten payload fields into run params', async () => {
    const runStore = new InMemoryStore();
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ runStore, spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    await postWebhook(`http://127.0.0.1:${addr.port}`, { deliveryId: 'params-delivery-001' });

    const runs = await runStore.list(testWorkflow.id);
    expect(runs.length).toBe(1);
    const run = await runStore.get(runs[0]!.id);
    const params = run.params as Record<string, unknown>;

    expect(params['pr_number']).toBe(42);
    expect(params['pr_url']).toBe('https://github.com/org/repo/pull/42');
    expect(params['repo_owner']).toBe('org');
    expect(params['repo_name']).toBe('repo');
    expect(params['pr_title']).toBe('Test PR title');
    expect(params['base_sha']).toBe('base_sha_abc123');
    expect(params['head_sha']).toBe('head_sha_def456');
    expect(params['author']).toBe('testuser');
    expect(params['pr_action']).toBe('opened');
    expect(params['github_delivery_id']).toBe('params-delivery-001');
  });

  it('appends --provider to spawn args when provider option is set', async () => {
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ provider: 'anthropic', spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    await postWebhook(`http://127.0.0.1:${addr.port}`);

    expect(mockSpawn).toHaveBeenCalledOnce();
    const spawnArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(spawnArgs).toContain('--provider');
    expect(spawnArgs).toContain('anthropic');
  });

  it('appends --model to spawn args when model option is set', async () => {
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ model: 'claude-3-5-sonnet', spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    await postWebhook(`http://127.0.0.1:${addr.port}`);

    expect(mockSpawn).toHaveBeenCalledOnce();
    const spawnArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(spawnArgs).toContain('--model');
    expect(spawnArgs).toContain('claude-3-5-sonnet');
  });

  it('does not include --provider or --model in spawn args when both are absent', async () => {
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    await postWebhook(`http://127.0.0.1:${addr.port}`);

    expect(mockSpawn).toHaveBeenCalledOnce();
    const spawnArgs = mockSpawn.mock.calls[0]![1] as string[];
    expect(spawnArgs).not.toContain('--provider');
    expect(spawnArgs).not.toContain('--model');
  });

  it('creates independent runs and spawns two children for concurrent valid deliveries', async () => {
    const runStore = new InMemoryStore();
    const mockSpawn = vi.fn().mockReturnValue(makeMockChild());
    ({ server } = await startTestServer({ runStore, spawnFn: mockSpawn }));
    const addr = server.address() as { port: number };

    const [res1, res2] = await Promise.all([
      postWebhook(`http://127.0.0.1:${addr.port}`, { deliveryId: 'concurrent-1' }),
      postWebhook(`http://127.0.0.1:${addr.port}`, { deliveryId: 'concurrent-2' }),
    ]);

    expect(res1.status).toBe(202);
    expect(res2.status).toBe(202);

    const body1 = (await res1.json()) as { run_id: string };
    const body2 = (await res2.json()) as { run_id: string };
    expect(body1.run_id).not.toBe(body2.run_id);

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const runs = await runStore.list(testWorkflow.id);
    expect(runs.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// webhookCommand startup validation
// ---------------------------------------------------------------------------

describe('webhookCommand startup validation', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Ensure env var is not set unless the test sets it
    delete process.env['GITHUB_WEBHOOK_SECRET'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['GITHUB_WEBHOOK_SECRET'];
  });

  it('exits with 1 when neither --secret nor GITHUB_WEBHOOK_SECRET is set', async () => {
    await webhookCommand
      .parseAsync(['node', 'realm', '--workflow', 'some/path', '--port', '9999'])
      .catch(() => {});
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('webhook secret is required'),
    );
  });

  it('exits with 1 when workflow file does not exist', async () => {
    process.env['GITHUB_WEBHOOK_SECRET'] = 'testsecret';
    await webhookCommand
      .parseAsync(['node', 'realm', '--workflow', '/nonexistent/workflow.yaml', '--port', '9999'])
      .catch(() => {});
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('failed to load workflow'));
  });
});
