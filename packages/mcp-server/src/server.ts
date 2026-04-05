#!/usr/bin/env node
// realm-mcp — MCP server exposing the Realm workflow engine to AI agents.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ExtensionRegistry } from '@sensigo/realm';
import { JsonWorkflowStore, JsonFileStore } from '@sensigo/realm';
import { registerListWorkflows } from './tools/list-workflows.js';
import { registerGetWorkflowProtocol } from './tools/get-workflow-protocol.js';
import { registerStartRun } from './tools/start-run.js';
import { registerExecuteStep } from './tools/execute-step.js';
import { registerSubmitHumanResponse } from './tools/submit-human-response.js';
import { registerGetRunState } from './tools/get-run-state.js';

export interface RealmMcpServerOptions {
  /** Extension registry for resolving service adapters and step handlers at runtime. */
  registry?: ExtensionRegistry;
  /** Resolved secrets to pass to adapter configs (e.g. API tokens). */
  secrets?: Record<string, string>;
  /** Pre-populated workflow store. When provided, tools use this instead of creating
   *  a new JsonWorkflowStore() pointing at ~/.realm/workflows/. */
  workflowStore?: JsonWorkflowStore;
  /** Run store. When provided, tools use this instead of creating a new JsonFileStore(). */
  runStore?: JsonFileStore;
}

/**
 * Creates and configures the Realm MCP server with all 6 workflow tools.
 * Pass `registry` and `secrets` to enable auto steps that use service adapters
 * or custom step handlers.
 */
export function createRealmMcpServer(options?: RealmMcpServerOptions): McpServer {
  const server = new McpServer({
    name: 'realm',
    version: '0.1.0',
  });

  registerListWorkflows(server, options);
  registerGetWorkflowProtocol(server, options);
  registerStartRun(server, options);
  registerExecuteStep(server, options);
  registerSubmitHumanResponse(server, options);
  registerGetRunState(server, options);

  return server;
}

// Entry point: start the MCP server on stdio when run directly.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const server = createRealmMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
