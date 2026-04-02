#!/usr/bin/env node
// @sensigo/realm-cli — command-line interface for Realm
import { Command } from 'commander';
import { validateCommand } from './commands/validate.js';
import { registerCommand } from './commands/register.js';
import { runCommand } from './commands/run.js';
import { resumeCommand } from './commands/resume.js';
import { cleanupCommand } from './commands/cleanup.js';
import { respondCommand } from './commands/respond.js';

const program = new Command();

program
  .name('realm')
  .description('Realm workflow engine CLI')
  .version('0.1.0');

program.addCommand(validateCommand);
program.addCommand(registerCommand);
program.addCommand(runCommand);
program.addCommand(resumeCommand);
program.addCommand(cleanupCommand);
program.addCommand(respondCommand);

program.parse();
