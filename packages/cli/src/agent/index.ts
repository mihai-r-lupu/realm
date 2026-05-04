// Public agent interface surface for @sensigo/realm-cli/agent.
// Custom provider authors implement LlmProvider or ToolCapableLlmProvider against these types.
export type { LlmProvider, ToolCapableLlmProvider } from './llm-provider.js';
export type {
  ToolExecutor,
  StepWithToolsResult,
  ToolCallRecord,
  McpServerConfig,
} from './mcp-types.js';
