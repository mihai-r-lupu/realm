// realm validate <path> — validates a workflow YAML file without registering it.
import { Command } from 'commander';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadWorkflowFromString, WorkflowError } from '@sensigo/realm';

export const validateCommand = new Command('validate')
  .argument('<path>', 'Path to workflow directory or workflow.yaml file')
  .description('Validate a workflow YAML file')
  .action((inputPath: string) => {
    const filePath =
      inputPath.endsWith('.yaml') || inputPath.endsWith('.yml')
        ? inputPath
        : join(inputPath, 'workflow.yaml');

    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
      return;
    }

    try {
      const definition = loadWorkflowFromString(content);
      console.log(
        `Valid: ${definition.id} v${definition.version} (${Object.keys(definition.steps).length} steps)`,
      );
    } catch (err) {
      if (err instanceof WorkflowError) {
        console.error(`Invalid: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  });
