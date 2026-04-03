// @sensigo/realm-mcp — MCP server for AI agent connections
export { createRealmMcpServer } from './server.js';
export { generateProtocol } from './protocol/generator.js';
export type { WorkflowProtocol, ProtocolStep } from './protocol/generator.js';
export const VERSION = '0.1.0';
