// Protocol generator — produces the full agent briefing from a WorkflowDefinition.
// This is what an AI agent reads before starting a workflow run.
import type { WorkflowDefinition, JsonSchema, SimpleTransition, OnSuccessTransition } from '@sensigo/realm';
import { TERMINAL_STATES } from '@sensigo/realm';

export interface ProtocolStepGate {
  choices: string[];
}

export interface ProtocolStep {
  id: string;
  description: string;
  execution: string;
  /** Plain-English description of the agent's role at this step. */
  agent_involvement: string;
  input_schema?: JsonSchema;
  /** Step-level instructions for the agent, if defined. */
  instructions?: string;
  /** Present when the step may open a human gate. */
  possible_gate?: ProtocolStepGate;
  /** Conditional routing paths from this step, keyed by transition name (e.g. 'on_error', 'on_reject'). */
  transitions?: {
    on_error?: SimpleTransition;
    on_success?: OnSuccessTransition;
    [key: string]: SimpleTransition | OnSuccessTransition | undefined;
  };
  /** Specialist profile instructions for the agent at this step. Present when the step
   *  declares agent_profile and the profile was resolved at register time. */
  agent_profile_instructions?: string;
}

export interface WorkflowProtocol {
  workflow_id: string;
  name: string;
  params_schema?: JsonSchema;
  steps: ProtocolStep[];
  /** e.g. "2 of 4 steps require agent action. 2 are handled automatically." */
  agent_steps_summary: string;
  rules: string[];
  error_handling: Record<string, string>;
  quick_start: string;
}

const DEFAULT_RULES = [
  "Follow the next_action instruction in each response exactly.",
  "When you receive status 'confirm_required', read gate.agent_hint for instructions, present gate.display to the user verbatim, wait for their response, then call submit_human_response with their choice and the gate_id.",
  "Do NOT auto-confirm any human gate. The user must decide.",
  "Do NOT ask the user for permission between steps unless the system tells you to.",
];

const ERROR_HANDLING: Record<string, string> = {
  provide_input: "The engine rejected your input. Read the error details — they tell you exactly what was wrong. Fix the input and call the step again.",
  report_to_user: "Something failed that you cannot fix automatically. Show the error message to the user and wait for their guidance.",
  resolve_precondition: "A prerequisite step has not completed. The error includes which precondition failed and what step to call. Follow the suggestion.",
  stop: "A critical error occurred. Report it to the user and do not attempt any further steps.",
  wait_for_human: "A human decision is needed. Show the gate preview to the user and call submit_human_response with their choice.",
};

/**
 * Generates the full agent protocol briefing from a WorkflowDefinition.
 */
export function generateProtocol(definition: WorkflowDefinition): WorkflowProtocol {
  const steps: ProtocolStep[] = [];
  let agentStepCount = 0;
  let autoStepCount = 0;

  for (const [id, step] of Object.entries(definition.steps)) {
    const hasGate =
      step.trust === 'human_confirmed' || step.trust === 'human_reviewed';

    let agent_involvement: string;
    let possible_gate: ProtocolStepGate | undefined;

    if (step.execution === 'auto' && !hasGate) {
      agent_involvement = "none — engine handles this automatically";
      autoStepCount++;
    } else if (step.execution === 'auto' && hasGate) {
      agent_involvement =
        "YOU will receive `status: confirm_required` after this step runs — the engine executes it automatically, then opens a gate. Read `gate.agent_hint` for presentation instructions, present `gate.display` to the user verbatim, collect their choice from `gate.response_spec.choices`, and call `submit_human_response`.";
      possible_gate = { choices: ['approve', 'reject'] };
      autoStepCount++;
    } else if (step.execution === 'agent' && !hasGate) {
      agent_involvement = `YOU execute this step. Call execute_step with command '${id}' and the required params.`;

      // If this step's produced state leads immediately into an auto+gate step,
      // warn the agent upfront — they will receive confirm_required, not ok.
      if (!TERMINAL_STATES.has(step.produces_state)) {
        const immediateNext = Object.entries(definition.steps).find(
          ([, s]) =>
            s.execution === 'auto' &&
            (s.trust === 'human_confirmed' || s.trust === 'human_reviewed') &&
            Array.isArray(s.allowed_from_states) &&
            s.allowed_from_states.includes(step.produces_state),
        );
        if (immediateNext) {
          agent_involvement +=
            ` After you submit, you will receive status: confirm_required directly in response to this call — the engine runs '${immediateNext[0]}' automatically before returning.`;
        }
      }

      agentStepCount++;
    } else {
      // execution === 'agent' with gate
      agent_involvement = `YOU execute this step. Call execute_step with command '${id}'. The engine will run your dispatcher, then pause for human confirmation of your output.`;
      possible_gate = { choices: ['approve', 'reject'] };
      agentStepCount++;
    }

    const protocolStep: ProtocolStep = {
      id,
      description: step.description,
      execution: step.execution,
      agent_involvement,
    };

    if (step.input_schema !== undefined) {
      protocolStep.input_schema = step.input_schema;
    }
    if (step.instructions !== undefined) {
      protocolStep.instructions = step.instructions;
    }
    if (possible_gate !== undefined) {
      protocolStep.possible_gate = possible_gate;
    }
    if (step.transitions !== undefined) {
      protocolStep.transitions = step.transitions;
    }
    const profile = step.agent_profile;
    if (profile !== undefined && definition.resolved_profiles?.[profile] !== undefined) {
      protocolStep.agent_profile_instructions = definition.resolved_profiles[profile].content;
    }

    steps.push(protocolStep);
  }

  const totalSteps = steps.length;
  const agent_steps_summary = `${agentStepCount} of ${totalSteps} steps require agent action. ${autoStepCount} are handled automatically.`;

  const rules = definition.protocol?.rules ?? DEFAULT_RULES;

  const quick_start =
    definition.protocol?.quick_start ??
    `Call start_run with workflow_id '${definition.id}'. ${agentStepCount > 0 ? `The engine will run auto steps automatically and return control at the first step requiring agent action.` : `The engine handles all steps automatically.`} Follow the next_action in each response until the workflow completes.`;

  const protocol: WorkflowProtocol = {
    workflow_id: definition.id,
    name: definition.name,
    steps,
    agent_steps_summary,
    rules,
    error_handling: ERROR_HANDLING,
    quick_start,
  };

  if (definition.params_schema !== undefined) {
    protocol.params_schema = definition.params_schema;
  }

  return protocol;
}
