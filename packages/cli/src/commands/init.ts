// init command — scaffolds a new workflow project directory.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Command } from 'commander';

/**
 * Scaffolds a new workflow project at targetDir with four template files.
 * Throws an error if targetDir already exists.
 * @param name      Workflow project name used in file contents.
 * @param targetDir Directory to create (defaults to join(cwd, name) in the command action).
 */
export async function initWorkflow(name: string, targetDir: string): Promise<void> {
  if (existsSync(targetDir)) {
    throw new Error(`Directory already exists: ${targetDir}`);
  }

  await mkdir(targetDir, { recursive: true });

  const workflowYaml = `# ${name} workflow
id: ${name}
name: "${name}"
version: 1
initial_state: created

steps:
  step_one:
    description: "First step \u2014 replace with your own"
    execution: agent
    allowed_from_states: [created]
    produces_state: step_one_done
    input_schema:
      type: object
      required: [result]
      properties:
        result:
          type: string

  finalize:
    description: "Final step"
    execution: auto
    allowed_from_states: [step_one_done]
    produces_state: completed
`;

  const schemaJson = JSON.stringify(
    {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
    null,
    2,
  );

  const envExample = `# Add your secrets here
# EXAMPLE_API_KEY=your_key_here
`;

  const readmeMd = `# ${name}

A Realm workflow.

## Run

\`\`\`bash
realm validate ./
realm register ./
realm run ./
\`\`\`

## Test

Add fixtures to \`fixtures/\` and run:

\`\`\`bash
realm test ./ --fixtures ./fixtures/
\`\`\`
`;

  await writeFile(join(targetDir, 'workflow.yaml'), workflowYaml, 'utf8');
  await writeFile(join(targetDir, 'schema.json'), schemaJson + '\n', 'utf8');
  await writeFile(join(targetDir, '.env.example'), envExample, 'utf8');
  await writeFile(join(targetDir, 'README.md'), readmeMd, 'utf8');
}

export const initCommand = new Command('init')
  .argument('<name>', 'Workflow project name (becomes the directory name)')
  .description('Scaffold a new workflow project')
  .action(async (name: string) => {
    const { join: pathJoin } = await import('node:path');
    const targetDir = pathJoin(process.cwd(), name);
    try {
      await initWorkflow(name, targetDir);
      console.log(`Created: ${name}/`);
      console.log('  workflow.yaml');
      console.log('  schema.json');
      console.log('  .env.example');
      console.log('  README.md');
      console.log('');
      console.log(`Next: realm validate ./${name}/`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
