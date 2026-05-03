// mcp-client.ts — Manages stdio MCP server subprocess lifecycles.
// This is the only file in the codebase that imports @modelcontextprotocol/sdk directly.
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorkflowError } from '@sensigo/realm';
import type { McpClient as IMcpClient, McpServerConfig, McpTool } from './mcp-types.js';

export class McpClient implements IMcpClient {
  private readonly _servers: Map<string, McpServerConfig>;
  private readonly _clients: Map<string, Client> = new Map();

  constructor(servers: McpServerConfig[], signal?: AbortSignal) {
    this._servers = new Map(servers.map((s) => [s.id, s]));
    if (signal) {
      // Register unconditionally — a signal that fires before first connect must still trigger cleanup.
      signal.addEventListener(
        'abort',
        () => {
          void this.disconnect();
        },
        { once: true },
      );
    }
  }

  /**
   * Creates and connects an SDK Client for the given config.
   * Override in tests to inject an in-process transport and avoid spawning real subprocesses.
   */
  protected async _createClient(
    config: McpServerConfig,
    expandedEnv: Record<string, string>,
  ): Promise<Client> {
    const params: { command: string; args?: string[]; env?: Record<string, string> } = {
      command: config.command ?? '',
      ...(config.args !== undefined ? { args: config.args } : {}),
      ...(Object.keys(expandedEnv).length > 0 ? { env: expandedEnv } : {}),
    };
    const transport = new StdioClientTransport(params);
    const client = new Client({ name: 'realm-agent', version: '0.1.0' });
    try {
      await client.connect(transport);
    } catch (e) {
      throw new WorkflowError(`MCP server '${config.id}': connection failed: ${String(e)}`, {
        code: 'MCP_CONNECTION_FAILED',
        category: 'ENGINE',
        agentAction: 'stop',
        retryable: false,
      });
    }
    return client;
  }

  async connect(serverId: string): Promise<void> {
    if (this._clients.has(serverId)) return;
    const config = this._servers.get(serverId);
    if (!config) {
      throw new WorkflowError(`MCP server '${serverId}' is not configured`, {
        code: 'MCP_CONNECTION_FAILED',
        category: 'ENGINE',
        agentAction: 'stop',
        retryable: false,
      });
    }
    const expandedEnv = this._expandEnv(serverId, config);
    const client = await this._createClient(config, expandedEnv);
    // Idempotency check after await — guards against concurrent connect() calls.
    if (!this._clients.has(serverId)) {
      this._clients.set(serverId, client);
    } else {
      void client.close();
    }
  }

  async getTools(serverId: string, allowList: string[]): Promise<McpTool[]> {
    await this.connect(serverId);
    const client = this._clients.get(serverId)!;
    const result = await client.listTools();
    const tools: McpTool[] = result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
    if (allowList.length === 0) return tools;
    return tools.filter((t) => allowList.includes(t.name));
  }

  async call(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connect(serverId);
    const client = this._clients.get(serverId)!;
    return client.callTool({ name: toolName, arguments: args });
  }

  async disconnect(): Promise<void> {
    const clients = [...this._clients.values()];
    this._clients.clear();
    await Promise.allSettled(clients.map((c) => c.close()));
  }

  private _expandEnv(serverId: string, config: McpServerConfig): Record<string, string> {
    const expanded: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env ?? {})) {
      const result = value.replace(/\$\{([^}]+)\}/g, (_match, varName: string): string => {
        const v = process.env[varName];
        if (v === undefined) {
          throw new WorkflowError(`MCP server '${serverId}': env var ${varName} is not set`, {
            code: 'MCP_CONNECTION_FAILED',
            category: 'ENGINE',
            agentAction: 'stop',
            retryable: false,
          });
        }
        return v;
      });
      expanded[key] = result;
    }
    return expanded;
  }
}
