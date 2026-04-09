#!/usr/bin/env node
// mcp-server.ts — entry point for the document-intake MCP server.
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadWorkflowFromFile, JsonWorkflowStore } from '@sensigo/realm';
import { createRealmMcpServer, createDefaultRegistry } from '@sensigo/realm-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ValidateIntakeFieldsHandler } from './handlers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Start from the default registry (includes FileSystemAdapter) and add the workflow-specific handler.
const registry = createDefaultRegistry();
registry.register('handler', 'validate_intake_fields', new ValidateIntakeFieldsHandler());

const definition = loadWorkflowFromFile(join(__dirname, '..', 'workflow.yaml'));

const workflowStore = new JsonWorkflowStore();
await workflowStore.register(definition);

const server = createRealmMcpServer({ workflowStore, registry });
const transport = new StdioServerTransport();
await server.connect(transport);
