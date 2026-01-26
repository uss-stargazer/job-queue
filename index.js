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
  .option('-j, --jobqueue <path>', 'path to jobqueue.json')
  .option('-p, --projectpool <path>', 'path to projectpool.json')
  .option(
    '-e, --editor <editor>',
    'name of editor to use (fallbacks to env vars)',
  )
  .action(async (options) => {
    if (!options.jobqueue || options.jobqueue.length === 0)
      options.jobqueue = './jobqueue.json';
    if (!options.projectpool || options.projectpool.length === 0)
      options.projectpool = './projectpool.json';
    if (options.editor && options.editor.length === 0)
      options.editor = undefined;

    await main(options.jobqueue, options.projectpool, options.editor)
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
