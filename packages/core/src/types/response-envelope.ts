// Types for the ResponseEnvelope returned by every step execution.
import type { EvidenceSnapshot } from './run-record.js';

/** Describes a parameter the agent must supply at call time. */
export interface RequiredParam {
  name: string;
  description: string;
  valid_values?: string[];
}

export interface NextAction {
  instruction: {
    tool: string;
    params: Record<string, unknown>;
    /** Parameters the agent must supply when calling the tool. Disjoint from params. */
    params_required?: RequiredParam[];
  } | null;
  human_readable: string;
  context_hint: string;
  expected_timeout?: string;
  /** The step's declared input schema — use this to structure the params argument of your execute_step call. */
  input_schema?: Record<string, unknown>;
  /** Template-resolved step prompt, delivered to the agent at step entry. */
  prompt?: string;
}

export type RunStatus = 'ok' | 'error' | 'blocked' | 'confirm_required' | 'warning';

export interface BlockedReason {
  current_state: string;
  allowed_states: string[];
  suggestion?: string;
}

export interface GateInfo {
  gate_id: string;
  step_name: string;
  preview: Record<string, unknown>;
  choices: string[];
  /** Template-resolved prompt for this gate step — present the human with this before asking for choice. */
  prompt?: string;
}

export interface ResponseEnvelope {
  command: string;
  run_id: string;
  snapshot_id: string;
  status: RunStatus;
  data: Record<string, unknown>;
  evidence: EvidenceSnapshot[];
  warnings: string[];
  errors: string[];
  next_action: NextAction | null;
  blocked_reason?: BlockedReason;
  gate?: GateInfo;
}
