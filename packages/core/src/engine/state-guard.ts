// State guard — enforces allowed_from_states rules per workflow definition.
import type { WorkflowDefinition } from '../types/workflow-definition.js';
import type { BlockedReason } from '../types/response-envelope.js';

export class StateGuard {
  private readonly allowed: Map<string, Set<string>>;

  constructor(definition: WorkflowDefinition) {
    this.allowed = new Map();
    for (const [stepName, step] of Object.entries(definition.steps)) {
      this.allowed.set(stepName, new Set(step.allowed_from_states));
    }
  }

  isAllowed(stepName: string, currentState: string): boolean {
    const states = this.allowed.get(stepName);
    if (states === undefined) return false;
    return states.has(currentState);
  }

  getBlockedReason(stepName: string, currentState: string): BlockedReason {
    return {
      current_state: currentState,
      allowed_states: this.getAllowedStates(stepName),
      suggestion: `Step '${stepName}' cannot execute from state '${currentState}'.`,
    };
  }

  getAllowedStates(stepName: string): string[] {
    const states = this.allowed.get(stepName);
    return states !== undefined ? [...states] : [];
  }
}
