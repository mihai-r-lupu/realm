#!/usr/bin/env node
// mcp-server.ts — starts the Realm MCP server with the code-review workflow registered.
// Used for Mode 1: connect a VS Code agent with MCP support to this server.
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  loadWorkflowFromFile,
  JsonWorkflowStore,
  FileSystemAdapter,
  ExtensionRegistry,
} from '@sensigo/realm';
import { createRealmMcpServer } from '@sensigo/realm-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register the FileSystemAdapter so the read_code step can read files from disk.
const registry = new ExtensionRegistry();
registry.register('adapter', 'filesystem', new FileSystemAdapter('filesystem'));

// Register the workflow so the MCP tools can find it by id.
const definition = loadWorkflowFromFile(join(__dirname, '..', 'workflow.yaml'));
const workflowStore = new JsonWorkflowStore();
await workflowStore.register(definition);

// Start server on stdio — the agent connects here.
const server = createRealmMcpServer({ workflowStore, registry });
const transport = new StdioServerTransport();
await server.connect(transport);
