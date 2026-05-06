// Public agent interface surface for @sensigo/realm-cli/agent.
// Custom provider authors implement LlmProvider or ToolCapableLlmProvider against these types.
export { LlmProvider, ToolCapableLlmProvider } from './providers/llm-provider.js';
export type { ProviderCapabilities } from './providers/llm-provider.js';
export type {
  ToolExecutor,
  StepWithToolsResult,
  ToolCallRecord,
  McpServerConfig,
} from './mcp/mcp-extensions.js';
