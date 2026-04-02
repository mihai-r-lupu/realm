// realm register <path> — validates and registers a workflow from a YAML file.
import { Command } from 'commander';
import { join } from 'node:path';
import { loadWorkflowFromFile, JsonWorkflowStore } from '@sensigo/realm';

export const registerCommand = new Command('register')
  .argument('<path>', 'Path to workflow directory or workflow.yaml file')
  .description('Register a workflow definition')
  .action(async (inputPath: string) => {
    const filePath =
      inputPath.endsWith('.yaml') || inputPath.endsWith('.yml')
        ? inputPath
        : join(inputPath, 'workflow.yaml');

    try {
      const definition = loadWorkflowFromFile(filePath);
      const store = new JsonWorkflowStore();
      await store.register(definition);
      console.log(
        `Registered: ${definition.id} v${definition.version} (${Object.keys(definition.steps).length} steps)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
