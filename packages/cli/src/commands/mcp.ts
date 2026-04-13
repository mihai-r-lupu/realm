// realm mcp — starts the global Realm MCP server.
// Serves all workflows registered via `realm workflow register`.
// For custom handlers or adapters, build a small mcp-server.ts that calls
// createRealmMcpServer({ workflowStore, registry }) with your extended registry.
import { Command } from 'commander';
import { JsonWorkflowStore } from '@sensigo/realm';
import { createRealmMcpServer } from '@sensigo/realm-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Starts the Realm MCP server using the global workflow store (~/.realm/workflows/).
 * All workflows registered via `realm workflow register` are immediately available.
 * Built-in adapters (FileSystemAdapter etc.) are included automatically.
 */
export const mcpCommand = new Command('mcp')
  .description('Start the Realm MCP server (serves all registered workflows via stdio)')
  .action(async () => {
    const workflowStore = new JsonWorkflowStore();
    const server = createRealmMcpServer({ workflowStore });
    const transport = new StdioServerTransport();
    await server.connect(transport);
  });
