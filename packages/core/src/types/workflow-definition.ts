// Typed representation of a parsed workflow YAML definition.

export type ExecutionMode = 'auto' | 'agent';

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
  handler?: string;
  input_schema?: JsonSchema;
  preconditions?: string[];
  trust?: TrustLevel;
  timeout_seconds?: number;
  retry?: RetryConfig;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  initial_state: string;
  services?: Record<string, ServiceDefinition>;
  steps: Record<string, StepDefinition>;
}
