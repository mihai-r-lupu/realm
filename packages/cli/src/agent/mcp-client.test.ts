// mcp-client.test.ts — Unit tests for McpClient using in-process MCP servers
// via InMemoryTransport. No real subprocess is spawned.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpClient } from './mcp-client.js';
import type { McpServerConfig } from './mcp-types.js';
import { WorkflowError } from '@sensigo/realm';

// TestMcpClient overrides _createClient to inject a pre-built in-process client,
// avoiding real subprocess spawning while preserving all McpClient logic.
class TestMcpClient extends McpClient {
  private _nextClient: Client | null = null;
  connectCallCount = 0;

  setNextClient(client: Client): void {
    this._nextClient = client;
  }

  protected override async _createClient(
    _config: McpServerConfig,
    _env: Record<string, string>,
  ): Promise<Client> {
    this.connectCallCount++;
    if (!this._nextClient) throw new Error('No test client configured');
    return this._nextClient;
  }
}

// Starts an in-process McpServer and connects an SDK Client to it via InMemoryTransport.
async function makeInProcessClient(
  server: McpServer,
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'realm-test', version: '1.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    cleanup: async () => {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

// Creates a McpServer pre-loaded with named tools, each returning a text result.
function makeServer(
  tools: Array<{ name: string; description: string; result: unknown }>,
): McpServer {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  for (const t of tools) {
    // Zero-arg tool — callback receives only the extra context argument.
    server.tool(t.name, t.description, () => ({
      content: [{ type: 'text' as const, text: JSON.stringify(t.result) }],
    }));
  }
  return server;
}

const defaultConfig: McpServerConfig = {
  id: 'test-server',
  transport: 'stdio',
  command: 'fake-cmd',
};

describe('McpClient', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it('getTools triggers lazy connect on first call; subsequent calls to same server do not reconnect', async () => {
    const server = makeServer([{ name: 'tool-a', description: 'Tool A', result: 'a' }]);
    const { client, cleanup: c } = await makeInProcessClient(server);
    cleanup = c;

    const mcpClient = new TestMcpClient([defaultConfig]);
    mcpClient.setNextClient(client);

    await mcpClient.getTools('test-server', []);
    await mcpClient.getTools('test-server', []);

    expect(mcpClient.connectCallCount).toBe(1);
    await mcpClient.disconnect();
  });

  it('getTools with allowList returns only matching tools', async () => {
    const server = makeServer([
      { name: 'alpha', description: 'Alpha', result: 1 },
      { name: 'beta', description: 'Beta', result: 2 },
      { name: 'gamma', description: 'Gamma', result: 3 },
    ]);
    const { client, cleanup: c } = await makeInProcessClient(server);
    cleanup = c;

    const mcpClient = new TestMcpClient([defaultConfig]);
    mcpClient.setNextClient(client);

    const tools = await mcpClient.getTools('test-server', ['alpha', 'gamma']);
    expect(tools.map((t) => t.name)).toEqual(['alpha', 'gamma']);
    await mcpClient.disconnect();
  });

  it('getTools with empty allowList returns all tools', async () => {
    const server = makeServer([
      { name: 'x', description: 'X', result: 1 },
      { name: 'y', description: 'Y', result: 2 },
    ]);
    const { client, cleanup: c } = await makeInProcessClient(server);
    cleanup = c;

    const mcpClient = new TestMcpClient([defaultConfig]);
    mcpClient.setNextClient(client);

    const tools = await mcpClient.getTools('test-server', []);
    expect(tools.map((t) => t.name)).toEqual(['x', 'y']);
    await mcpClient.disconnect();
  });

  it('call triggers lazy connect on first call', async () => {
    const server = makeServer([{ name: 'echo', description: 'Echo', result: 'hi' }]);
    const { client, cleanup: c } = await makeInProcessClient(server);
    cleanup = c;

    const mcpClient = new TestMcpClient([defaultConfig]);
    mcpClient.setNextClient(client);

    await mcpClient.call('test-server', 'echo', {});
    expect(mcpClient.connectCallCount).toBe(1);
    await mcpClient.disconnect();
  });

  it('call returns the raw result from the server', async () => {
    const server = makeServer([{ name: 'echo', description: 'Echo', result: { value: 42 } }]);
    const { client, cleanup: c } = await makeInProcessClient(server);
    cleanup = c;

    const mcpClient = new TestMcpClient([defaultConfig]);
    mcpClient.setNextClient(client);

    const result = await mcpClient.call('test-server', 'echo', {});
    // Raw result is a CallToolResult — content array is present and unmodified
    expect((result as { content: unknown[] }).content).toBeDefined();
    expect((result as { content: Array<{ type: string; text: string }> }).content[0]?.text).toBe(
      JSON.stringify({ value: 42 }),
    );
    await mcpClient.disconnect();
  });

  it('double-connect is idempotent — no error, _createClient called once', async () => {
    const server = makeServer([{ name: 'noop', description: 'Noop', result: null }]);
    const { client, cleanup: c } = await makeInProcessClient(server);
    cleanup = c;

    const mcpClient = new TestMcpClient([defaultConfig]);
    mcpClient.setNextClient(client);

    await mcpClient.connect('test-server');
    await mcpClient.connect('test-server');

    expect(mcpClient.connectCallCount).toBe(1);
    await mcpClient.disconnect();
  });

  it('disconnect() is idempotent — calling twice does not throw', async () => {
    const mcpClient = new TestMcpClient([defaultConfig]);
    await expect(mcpClient.disconnect()).resolves.toBeUndefined();
    await expect(mcpClient.disconnect()).resolves.toBeUndefined();
  });

  it('AbortSignal listener fires disconnect() when signal is aborted', () => {
    const controller = new AbortController();
    const mcpClient = new TestMcpClient([defaultConfig], controller.signal);
    const spy = vi.spyOn(mcpClient, 'disconnect');

    controller.abort();

    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('AbortSignal registered at construction, fires before first connect — disconnect() called, no error', () => {
    const controller = new AbortController();
    const mcpClient = new TestMcpClient([defaultConfig], controller.signal);

    expect(() => {
      controller.abort();
    }).not.toThrow();
    // No connect was ever called
    expect(mcpClient.connectCallCount).toBe(0);
  });

  it('missing env var at connect time throws WorkflowError naming the variable', async () => {
    const config: McpServerConfig = {
      id: 'gh',
      transport: 'stdio',
      command: 'gh-server',
      env: { TOKEN: '${REALM_TEST_MISSING_VAR_XYZ_12345}' },
    };
    delete process.env['REALM_TEST_MISSING_VAR_XYZ_12345'];

    const mcpClient = new TestMcpClient([config]);
    await expect(mcpClient.connect('gh')).rejects.toThrow(
      "MCP server 'gh': env var REALM_TEST_MISSING_VAR_XYZ_12345 is not set",
    );
  });

  it('unknown serverId in getTools throws WorkflowError', async () => {
    const mcpClient = new TestMcpClient([defaultConfig]);
    await expect(mcpClient.getTools('does-not-exist', [])).rejects.toThrow(WorkflowError);
  });

  it('unknown serverId in call throws WorkflowError', async () => {
    const mcpClient = new TestMcpClient([defaultConfig]);
    await expect(mcpClient.call('does-not-exist', 'any-tool', {})).rejects.toThrow(WorkflowError);
  });

  it('disconnect() called in constructor signal listener uses void — no unhandled rejection', async () => {
    const controller = new AbortController();
    const mcpClient = new TestMcpClient([defaultConfig], controller.signal);

    // Abort triggers void this.disconnect() — no unhandled rejection should occur
    controller.abort();

    // Let microtasks settle
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // No connection was established — disconnect() resolved cleanly
    expect(mcpClient.connectCallCount).toBe(0);
  });
});
