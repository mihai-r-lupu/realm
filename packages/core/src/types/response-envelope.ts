// Types for the ResponseEnvelope returned by every step execution.
import type { EvidenceSnapshot } from './run-record.js';

export interface NextAction {
  instruction: {
    tool: string;
    params: Record<string, unknown>;
  } | null;
  human_readable: string;
  context_hint: string;
  expected_timeout?: string;
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
