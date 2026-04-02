// Standalone evidence capture utility — builds an EvidenceSnapshot from step execution data.
import { createHash } from 'node:crypto';
import type { EvidenceSnapshot } from '../types/run-record.js';

export interface CaptureEvidenceParams {
  stepId: string;
  startedAt: Date;
  completedAt: Date;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
}

/** Builds an EvidenceSnapshot from step execution parameters, including a SHA-256 content hash. */
export function captureEvidence(params: CaptureEvidenceParams): EvidenceSnapshot {
  const evidenceHash = createHash('sha256')
    .update(JSON.stringify(params.output))
    .digest('hex');
  return {
    step_id: params.stepId,
    started_at: params.startedAt.toISOString(),
    completed_at: params.completedAt.toISOString(),
    duration_ms: params.completedAt.getTime() - params.startedAt.getTime(),
    input_summary: params.input,
    output_summary: params.output,
    status: params.error !== undefined ? 'error' : 'success',
    ...(params.error !== undefined ? { error: params.error } : {}),
    evidence_hash: evidenceHash,
  };
}
