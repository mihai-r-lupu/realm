#!/usr/bin/env node
// @sensigo/realm-cli — command-line interface for Realm
import { Command } from 'commander';
import { validateCommand } from './commands/validate.js';
import { registerCommand } from './commands/register.js';
import { runCommand } from './commands/run.js';
import { resumeCommand } from './commands/resume.js';
import { cleanupCommand } from './commands/cleanup.js';
import { respondCommand } from './commands/respond.js';
import { inspectCommand } from './commands/inspect.js';
import { replayCommand } from './commands/replay.js';
import { diffCommand } from './commands/diff.js';
import { initCommand } from './commands/init.js';
import { testCommand } from './commands/test.js';
import { watchCommand } from './commands/watch.js';
import { listCommand } from './commands/list.js';

const program = new Command();

program.name('realm').description('Realm workflow engine CLI').version('0.1.0');

// realm workflow — operations on workflow definitions
const workflowCmd = new Command('workflow').description('Manage workflow definitions');
workflowCmd.addCommand(initCommand);
workflowCmd.addCommand(validateCommand);
workflowCmd.addCommand(registerCommand);
workflowCmd.addCommand(watchCommand);
workflowCmd.addCommand(runCommand);
workflowCmd.addCommand(testCommand);

// realm run — operations on run instances
const runCmd = new Command('run').description('Manage workflow run instances');
runCmd.addCommand(listCommand);
runCmd.addCommand(inspectCommand);
runCmd.addCommand(replayCommand);
runCmd.addCommand(diffCommand);
runCmd.addCommand(resumeCommand);
runCmd.addCommand(respondCommand);
runCmd.addCommand(cleanupCommand);

program.addCommand(workflowCmd);
program.addCommand(runCmd);

program.parse();
