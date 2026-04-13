// Types for the ResponseEnvelope returned by every step execution.
import type { EvidenceSnapshot } from './run-record.js';
import type { AgentAction } from './workflow-error.js';

export interface NextAction {
  instruction: {
    tool: string;
    params: Record<string, unknown>;
    /**
     * Ready-to-use flat argument object for calling the tool.
     * Agent-supplied params appear as placeholder strings (e.g. "<YOUR_PARAMS>", "<approve|reject>").
     * Copy this object, replace the placeholder(s), and call the tool.
     */
    call_with: Record<string, unknown>;
  } | null;
  human_readable: string;
  /** Current state orientation — describes what state the run is in and what just happened. */
  orientation: string;
  expected_timeout?: string;
  /** The step's declared input schema — use this to structure the params argument of your execute_step call. */
  input_schema?: Record<string, unknown>;
  /** Template-resolved step prompt, delivered to the agent at step entry. */
  prompt?: string;
}

export type RunStatus = 'ok' | 'error' | 'blocked' | 'confirm_required';

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
  /** Template-resolved display content for this gate step — present to the human verbatim before asking for their choice. */
  display?: string;
  /** Agent-facing instructions for this gate step — how the agent should present the gate to the human. */
  agent_hint?: string;
  /** Structured response specification — the choices the human may select. */
  response_spec?: { choices: string[] };
}

export interface ResponseEnvelope {
  command: string;
  run_id: string;
  /** Opaque version token for optimistic concurrency. Pass back as snapshotId in your next call. For auditing only — do not parse. */
  snapshot_id: string;
  /**
   * Chain progress status.
   * - 'ok': the chain made forward progress; follow next_action for what to do next.
   *   Does NOT imply the original requested step succeeded — a branched recovery path
   *   also returns 'ok' with a warning carrying the original error.
   * - 'error': unrecoverable failure; agent_action tells you how to respond.
   * - 'blocked': wrong step for current state; next_action redirects.
   * - 'confirm_required': a human gate is open; gate carries the display content.
   */
  status: RunStatus;
  data: Record<string, unknown>;
  /** Audit trail of step executions in this response. For debugging and CLI inspection only. */
  evidence: EvidenceSnapshot[];
  warnings: string[];
  errors: string[];
  agent_action?: AgentAction;
  /** Current state orientation. Always populated — describes what just happened and what state the run is in. */
  context_hint: string;
  next_action: NextAction | null;
  blocked_reason?: BlockedReason;
  gate?: GateInfo;
  /**
   * Names and produced states of auto steps that ran silently as part of an executeChain call.
   * Only present when at least one auto step was chained. Useful for debugging and orientation
   * after start_run or after an agent step that triggers subsequent auto steps.
   */
  chained_auto_steps?: Array<{ step: string; produced_state: string; branched_via?: string }>;
}
