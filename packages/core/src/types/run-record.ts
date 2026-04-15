// Types for an active or historical workflow run record stored on disk.

/** Diagnostic metadata captured during step execution. Written once; read by inspect. */
export interface StepDiagnostics {
  /** Rough token count estimate: Math.ceil(JSON.stringify(input).length / 4) */
  input_token_estimate: number;
  /** Ordered list of precondition evaluations for this step. Empty array if no preconditions. */
  precondition_trace: Array<{
    expression: string;
    passed: boolean;
    resolved_value: unknown;
  }>;
}

export interface EvidenceSnapshot {
  step_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  input_summary: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  evidence_hash: string;
  attempt?: number;
  /** Distinguishes computation records from human decision records. Absent on pre-existing entries. */
  kind?: 'execution' | 'gate_response';
  /** Diagnostic metadata. Present on snapshots captured after Week 7. */
  diagnostics?: StepDiagnostics;
  /** Name of the agent profile active at this step, if any. */
  agent_profile?: string;
  /** SHA-256 hash of the profile content at register time. Auditable even if the file changes. */
  agent_profile_hash?: string;
}

export interface PendingGate {
  gate_id: string;
  step_name: string;
  /** Output produced by the step dispatcher; presented to the human for review. */
  preview: Record<string, unknown>;
  choices: string[];
  opened_at: string;
}

/**
 * Derived phase of a workflow run. Always computed from the four step sets and run state;
 * never set directly by callers outside the engine.
 */
export type RunPhase = 'running' | 'gate_waiting' | 'completed' | 'failed' | 'abandoned';

export interface RunRecord {
  id: string;
  workflow_id: string;
  workflow_version: number;

  // DAG execution state — replaces the single `state: string` field.
  completed_steps: string[];
  in_progress_steps: string[];
  failed_steps: string[];
  /** Steps whose trigger_rule can no longer be satisfied; recorded for auditability. */
  skipped_steps: string[];

  /**
   * Derived convenience field — set by the engine on every write, read by CLI and get_run_state.
   * Always computable from the four step sets, terminal_state, and pending_gate.
   */
  run_phase: RunPhase;

  version: number;
  params: Record<string, unknown>;
  evidence: EvidenceSnapshot[];
  created_at: string;
  updated_at: string;
  terminal_state: boolean;
  terminal_reason?: string;
  pending_gate?: PendingGate;
}
