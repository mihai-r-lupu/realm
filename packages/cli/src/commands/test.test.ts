// Tests for the realm test command's formatTestResults helper.
import { describe, it, expect } from 'vitest';
import { formatTestResults } from './test.js';
import type { TestResult } from '@sensigo/realm-testing';

describe('formatTestResults', () => {
  it('returns exit code 0 when all fixtures pass', () => {
    const results: TestResult[] = [
      { name: 'fixture-a', passed: true },
      { name: 'fixture-b', passed: true },
    ];
    const { exitCode } = formatTestResults(results);
    expect(exitCode).toBe(0);
  });

  it('returns exit code 1 when any fixture fails', () => {
    const results: TestResult[] = [
      { name: 'fixture-a', passed: true },
      { name: 'fixture-b', passed: false, error: 'wrong state' },
    ];
    const { exitCode } = formatTestResults(results);
    expect(exitCode).toBe(1);
  });

  it('includes error message in output line for a failed fixture', () => {
    const results: TestResult[] = [
      { name: 'broken-fixture', passed: false, error: 'Expected completed but got failed' },
    ];
    const { lines } = formatTestResults(results);
    expect(lines[0]).toContain('broken-fixture');
    expect(lines[0]).toContain('Expected completed but got failed');
  });

  it('PASS line contains fixture name for a passing fixture', () => {
    const results: TestResult[] = [{ name: 'good-fixture', passed: true }];
    const { lines } = formatTestResults(results);
    expect(lines[0]).toContain('good-fixture');
    expect(lines[0]).toContain('PASS');
  });
});
