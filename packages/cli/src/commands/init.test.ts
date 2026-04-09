// Tests for initWorkflow business logic.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkflow } from './init.js';
import { loadWorkflowFromString } from '@sensigo/realm';

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'realm-init-test-'));
});

describe('initWorkflow', () => {
  it('creates all four files with correct name substitution', async () => {
    const target = join(baseDir, 'my-workflow');
    await initWorkflow('my-workflow', target);

    const yaml = await readFile(join(target, 'workflow.yaml'), 'utf8');
    const schema = await readFile(join(target, 'schema.json'), 'utf8');
    const envEx = await readFile(join(target, '.env.example'), 'utf8');
    const readme = await readFile(join(target, 'README.md'), 'utf8');

    expect(yaml).toContain('id: my-workflow');
    expect(yaml).toContain('name: "my-workflow"');
    expect(schema).toContain('"$schema"');
    expect(envEx).toContain('EXAMPLE_API_KEY');
    expect(readme).toContain('# my-workflow');
    expect(readme).toContain('realm workflow validate');
  });

  it('throws an error when target directory already exists', async () => {
    const target = join(baseDir, 'existing-dir');
    await mkdir(target);
    await expect(initWorkflow('existing-dir', target)).rejects.toThrow('Directory already exists');
  });

  it('generated workflow.yaml passes loadWorkflowFromString without errors', async () => {
    const target = join(baseDir, 'valid-workflow');
    await initWorkflow('valid-workflow', target);
    const yaml = await readFile(join(target, 'workflow.yaml'), 'utf8');
    const def = loadWorkflowFromString(yaml);
    expect(def.id).toBe('valid-workflow');
    expect(def.steps).toHaveProperty('step_one');
    expect(def.steps).toHaveProperty('finalize');
  });
});
