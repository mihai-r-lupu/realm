#!/usr/bin/env node
// mcp-server.ts — starts the Realm MCP server with the incident-response workflow registered.
// Used for Mode 1: connect a VS Code agent with MCP support to this server.
// FileSystemAdapter is pre-registered automatically by createRealmMcpServer().
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadWorkflowFromFile, JsonWorkflowStore } from '@sensigo/realm';
import { createRealmMcpServer } from '@sensigo/realm-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const definition = loadWorkflowFromFile(join(__dirname, '..', 'workflow.yaml'));
const workflowStore = new JsonWorkflowStore();
await workflowStore.register(definition);

const server = createRealmMcpServer({ workflowStore });
const transport = new StdioServerTransport();
await server.connect(transport);
