#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import main from './dist/index.js';

const program = new Command();

program
  .name('job-queue')
  .description(
    'A CLI app to keep track of jobs/tasks built around a couple of JSON files.',
  )
  .version('0.0.0')
  .option(
    '-j, --jobqueue <path>',
    'path to jobqueue.json (optional, fallbacks to config)',
  )
  .option(
    '-p, --projectpool <path>',
    'path to projectpool.json (optional, fallbacks to config)',
  )
  .option(
    '-e, --editor <editor>',
    'name of editor to use (optional, fallbacks to config)',
  )
  .action(async (options) => {
    ['jobqueue', 'projectpool', 'editor'].forEach((key) => {
      if (!options[key] || options[key].length === 0) delete options[key];
    });

    await main({ ...options })
      .then(() => {
        console.log(chalk.cyanBright('🖖 Live long and prosper...'));
        process.exit();
      })
      .catch((error) => {
        console.log(chalk.red('An error occured:'));
        console.group();
        console.log(error.message || error);
        console.groupEnd();
        process.exit(1);
      });
  });

program.parse(process.argv);
