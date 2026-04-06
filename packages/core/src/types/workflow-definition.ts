// Typed representation of a parsed workflow YAML definition.

export type ExecutionMode = 'auto' | 'agent';

export interface ProtocolConfig {
  /** Override for the generated quick-start paragraph. */
  quick_start?: string;
  /** Behavioral rules injected verbatim into the agent protocol. */
  rules?: string[];
}

export type TrustLevel = 'auto' | 'human_notified' | 'human_confirmed' | 'human_reviewed';

export type ServiceTrust = 'engine_delivered' | 'engine_managed' | 'agent_provided';

export interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  [key: string]: unknown;
}

export interface ServiceDefinition {
  adapter: string;
  auth?: { token_from: string };
  trust: ServiceTrust;
}

export interface RetryConfig {
  max_attempts: number;
  backoff: 'linear' | 'exponential' | 'fixed';
  base_delay_ms: number;
}

export interface StepDefinition {
  description: string;
  execution: ExecutionMode;
  allowed_from_states: string[];
  produces_state: string;
  uses_service?: string;
  /**
   * Which adapter method to invoke for this service step.
   * Defaults to 'fetch' if omitted.
   */
  service_method?: 'fetch' | 'create' | 'update';
  /**
   * Operation name passed as the first argument to the adapter method.
   * Defaults to the step name if omitted.
   */
  operation?: string;
  handler?: string;
  input_schema?: JsonSchema;
  preconditions?: string[];
  trust?: TrustLevel;
  timeout_seconds?: number;
  retry?: RetryConfig;
  /** Plain-English instructions for the agent at this step. */
  instructions?: string;
  /**
   * Template-resolved task prompt delivered to the agent at step entry via next_action.prompt.
   * Supports {{ context.resources.STEP.FIELD }} and {{ run.params.FIELD }} references.
   * For human_confirmed steps, delivered as gate.prompt when the gate opens.
   */
  prompt?: string;
  /** Gate configuration — choices available to the human reviewer. */
  gate?: { choices?: string[] };
  /** Conditional routing based on step outcome or gate response. */
  transitions?: Record<string, { step: string; produces_state: string }>;
  /** Name of the agent profile for this step. Only valid on execution: 'agent' steps. */
  agent_profile?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  initial_state: string;
  /** JSON Schema describing the params accepted by start_run. */
  params_schema?: JsonSchema;
  /** Optional protocol customizations — overrides generated sections. */
  protocol?: ProtocolConfig;
  services?: Record<string, ServiceDefinition>;
  steps: Record<string, StepDefinition>;
  /** Optional: directory containing shared profile markdown files.
   *  Resolved relative to the workflow YAML file at load time.
   *  Falls back to <workflow-dir>/agents/ if omitted. */
  profiles_dir?: string;
  /**
   * Map of resolved profile content keyed by profile name.
   * Populated by loadWorkflowFromFile — absent when loaded from string.
   * Do not serialize/write to workflow YAML — this is a runtime-only field.
   */
  resolved_profiles?: Record<string, { content: string; content_hash: string }>;
}
