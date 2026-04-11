// replay-format.ts — shared formatting helper for precondition columns in replay output tables.

/** Formats a precondition comparison column for replay output tables. */
export function formatPrecondColumn(
  originalPass: boolean,
  replayPass: boolean,
  hasPreconditions: boolean,
): string {
  if (!hasPreconditions) return 'none';
  const orig = originalPass ? 'PASS' : 'BLOCKED';
  const replay = replayPass ? 'PASS' : 'BLOCKED';
  return `${orig} \u2192 ${replay}`;
}
