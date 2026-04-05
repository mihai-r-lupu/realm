// list-workflows tool — returns all registered workflows.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JsonWorkflowStore } from '@sensigo/realm';

export interface HandleStores {
  workflowStore?: JsonWorkflowStore;
}

/**
 * Business logic for the list_workflows tool.
 * Returns a summary of all registered workflows.
 */
export async function handleListWorkflows(
  stores?: HandleStores,
): Promise<{ workflows: Array<{ id: string; name: string; version: number }> }> {
  const store = stores?.workflowStore ?? new JsonWorkflowStore();
  const workflows = await store.list();
  return {
    workflows: workflows.map((w) => ({ id: w.id, name: w.name, version: w.version })),
  };
}

/** Registers the list_workflows MCP tool on the server. */
export function registerListWorkflows(server: McpServer, opts?: HandleStores): void {
  server.tool(
    'list_workflows',
    'List all registered Realm workflows.',
    async () => {
      const result = await handleListWorkflows(opts);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
