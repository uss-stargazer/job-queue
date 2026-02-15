#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';

import pkg from './package.json' with { type: 'json' };
import main from './dist/index.js';

const program = new Command();

program
  .name('job-queue')
  .description(pkg.description)
  .version(pkg.version)
  .option(
    '-c, --config <path>',
    'path to directory containing config.json (uses new system app dir by default)',
  )
  .option(
    '-j, --jobqueue <path>',
    'path to jobqueue.json (uses config by default)',
  )
  .option(
    '-p, --projectpool <path>',
    'path to projectpool.json (uses config by default)',
  )
  .option(
    '-e, --editor <editor>',
    'name of editor to use (uses config by default or git editor, if installed)',
  )
  .action(async (options) => {
    const configDir = options.config;
    delete options.config;
    [('jobqueue', 'projectpool', 'editor')].forEach((key) => {
      if (!options[key] || options[key].length === 0) delete options[key];
    });

    await main(configDir, { ...options })
      .finally(() => console.log()) // Seperation line
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
