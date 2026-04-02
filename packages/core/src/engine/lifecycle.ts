// Run lifecycle constants — shared between execution-loop.ts and CLI commands.

/** States from which the run cannot proceed without external intervention. */
export const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'completed', 'cancelled', 'failed', 'abandoned',
]);

/** Terminal states from which a run may be resumed. */
export const RESUMABLE_STATES: ReadonlySet<string> = new Set(['failed', 'abandoned']);

/**
 * Returns whether the given state is terminal.
 * Extracted here so execution-loop.ts and CLI commands share the same definition.
 */
export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state);
}
