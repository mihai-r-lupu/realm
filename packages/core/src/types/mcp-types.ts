// ToolCallRecord and McpServerConfig live in core because they are referenced by core types
// (EvidenceSnapshot, ExecuteChainOptions, WorkflowDefinition). Defining them in cli would
// create a circular import: core → cli → core.

export interface ToolCallRecord {
  server_id: string; // "github" — MCP server ID from mcp_servers[].id
  tool: string; // bare tool name: "get_pull_request" (NOT namespaced)
  args: Record<string, unknown>;
  result: string | null; // null if call failed; string is the sanitized serialized value
  duration_ms: number; // Date.now() before and after executor()
  error?: string; // sanitized error message if the call failed
}

export interface McpServerConfig {
  id: string;
  transport: 'stdio'; // 'http' added when HTTP transport lands
  command?: string; // command to spawn
  args?: string[];
  /** Values support "${VAR}" expansion from process.env at connect time */
  env?: Record<string, string>;
}
