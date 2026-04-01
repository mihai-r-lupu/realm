#!/usr/bin/env node
// @sensigo/realm-cli — command-line interface for Realm
import { Command } from 'commander';
import { validateCommand } from './commands/validate.js';

const program = new Command();

program
  .name('realm')
  .description('Realm workflow engine CLI')
  .version('0.1.0');

program.addCommand(validateCommand);

program.parse();
