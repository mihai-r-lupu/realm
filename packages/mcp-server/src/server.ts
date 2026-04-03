#!/usr/bin/env node
// realm-mcp — MCP server exposing the Realm workflow engine to AI agents.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerListWorkflows } from './tools/list-workflows.js';
import { registerGetWorkflowProtocol } from './tools/get-workflow-protocol.js';
import { registerStartRun } from './tools/start-run.js';
import { registerExecuteStep } from './tools/execute-step.js';
import { registerSubmitHumanResponse } from './tools/submit-human-response.js';
import { registerGetRunState } from './tools/get-run-state.js';

/**
 * Creates and configures the Realm MCP server with all 6 workflow tools.
 */
export function createRealmMcpServer(): McpServer {
  const server = new McpServer({
    name: 'realm',
    version: '0.1.0',
  });

  registerListWorkflows(server);
  registerGetWorkflowProtocol(server);
  registerStartRun(server);
  registerExecuteStep(server);
  registerSubmitHumanResponse(server);
  registerGetRunState(server);

  return server;
}

// Entry point: start the MCP server on stdio when run directly.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const server = createRealmMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
