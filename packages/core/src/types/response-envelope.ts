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
}

export type RunStatus = 'ok' | 'error' | 'blocked' | 'confirm_required' | 'warning';

export interface BlockedReason {
  current_state: string;
  allowed_states: string[];
  suggestion?: string;
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
}
