// realm test <workflow-path> --fixtures <dir> — runs fixture-based workflow tests.
import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { runFixtureTests } from '@sensigo/realm-testing';
import type { TestResult } from '@sensigo/realm-testing';

/**
 * Formats fixture test results for display.
 * Returns an array of output lines and the appropriate process exit code.
 */
export function formatTestResults(results: TestResult[]): { lines: string[]; exitCode: number } {
  const lines: string[] = [];
  let allPassed = true;

  for (const result of results) {
    if (result.passed) {
      lines.push(`  ${chalk.green('PASS')} ${result.name}`);
    } else {
      allPassed = false;
      const errorPart = result.error !== undefined ? `: ${result.error}` : '';
      lines.push(`  ${chalk.red('FAIL')} ${result.name}${errorPart}`);
    }
  }

  return { lines, exitCode: allPassed ? 0 : 1 };
}

export const testCommand = new Command('test')
  .argument('<workflow-path>', 'Path to workflow directory or workflow.yaml file')
  .requiredOption('-f, --fixtures <dir>', 'Directory containing fixture YAML files')
  .description('Run fixture-based workflow tests')
  .action(async (workflowPath: string, opts: { fixtures: string }) => {
    if (!existsSync(opts.fixtures)) {
      console.error(`Error: fixtures directory does not exist: ${opts.fixtures}`);
      process.exit(1);
      return;
    }

    let results: TestResult[];
    try {
      results = await runFixtureTests({ workflowPath, fixturesPath: opts.fixtures });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
      return;
    }

    if (results.length === 0) {
      console.error('Error: no fixture files found in the specified directory');
      process.exit(1);
      return;
    }

    const { lines, exitCode } = formatTestResults(results);
    const passed = results.filter((r) => r.passed).length;

    console.log(`\nRealm Test — ${workflowPath}`);
    for (const line of lines) {
      console.log(line);
    }
    console.log(`\n${passed}/${results.length} passed`);

    process.exit(exitCode);
  });
