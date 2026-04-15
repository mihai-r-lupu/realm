// createGateResponder — auto-responds to open human gates in test scenarios.
import {
  submitHumanResponse,
  type RunStore,
  type WorkflowDefinition,
  type ResponseEnvelope,
} from '@sensigo/realm';

/**
 * Auto-responds to any open human gate on the run.
 * Reads gate_id and step_name from run.pending_gate, looks up the choice in
 * gateResponses[step_name], defaults to 'approve'. Calls submitHumanResponse.
 * @throws Error if run.pending_gate is undefined.
 */
export async function createGateResponder(
  store: RunStore,
  definition: WorkflowDefinition,
  runId: string,
  gateResponses: Record<string, string>,
): Promise<ResponseEnvelope> {
  const run = await store.get(runId);
  if (run.pending_gate === undefined) {
    throw new Error('createGateResponder: run has no pending gate');
  }
  const choice = gateResponses[run.pending_gate.step_name] ?? 'approve';
  return submitHumanResponse(store, definition, {
    runId,
    gateId: run.pending_gate.gate_id,
    choice,
  });
}
