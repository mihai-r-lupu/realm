// slim-evidence utility — strips verbose I/O summaries from evidence entries for MCP responses.
import type { ResponseEnvelope } from '@sensigo/realm';

/**
 * Strips verbose I/O summaries and diagnostics from evidence entries for MCP responses.
 * Keeps only the fields needed for protocol orientation: step identity, status, timing, and error.
 */
export function slimEvidence(evidence: ResponseEnvelope['evidence']): ResponseEnvelope['evidence'] {
  return evidence.map(snap => ({
    step_id: snap.step_id,
    status: snap.status,
    duration_ms: snap.duration_ms,
    evidence_hash: snap.evidence_hash,
    ...(snap.attempt !== undefined ? { attempt: snap.attempt } : {}),
    ...(snap.error !== undefined ? { error: snap.error } : {}),
  })) as ResponseEnvelope['evidence'];
}
