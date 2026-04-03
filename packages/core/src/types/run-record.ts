// Types for an active or historical workflow run record stored on disk.

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
}

export interface PendingGate {
  gate_id: string;
  step_name: string;
  /** Output produced by the step dispatcher; presented to the human for review. */
  preview: Record<string, unknown>;
  choices: string[];
  opened_at: string;
}

export interface RunRecord {
  id: string;
  workflow_id: string;
  workflow_version: number;
  state: string;
  version: number;
  params: Record<string, unknown>;
  evidence: EvidenceSnapshot[];
  created_at: string;
  updated_at: string;
  terminal_state: boolean;
  terminal_reason?: string;
  pending_gate?: PendingGate;
}
