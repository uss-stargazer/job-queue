import chalk from 'chalk';
import clear from 'clear';
import figlet from 'figlet';
import { select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import {
  JobQueueSchema,
  makeJsonData,
  ProjectPoolSchema,
} from './definitions.js';
import actions, { actionNames } from './actions.js';

export default async function main(
  jobqueueJsonPath: string,
  projectpoolJsonPath: string,
  editor?: string,
): Promise<void> {
  const jobQueue = await makeJsonData(jobqueueJsonPath, JobQueueSchema);
  const projectPool = await makeJsonData(
    projectpoolJsonPath,
    ProjectPoolSchema,
  );

  clear();
  console.log(
    chalk.yellow(figlet.textSync('JobQueue', { horizontalLayout: 'full' })),
  );

  try {
    while (true) {
      const action = await select({
        message: 'Select action',
        choices: actionNames,
      });

      await actions[action]({ jobQueue, projectPool }, editor);

      console.log(); // New line for action seperation
    }
  } catch (error) {
    if (!(error instanceof ExitPromptError)) throw error;
  }
}
