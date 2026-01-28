import chalk from 'chalk';
import clear from 'clear';
import figlet from 'figlet';
import { select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import actions, {
  actionNames,
  actionsDependentOnJobs,
  actionsDependentOnProjects,
} from './actions.js';
import { getJobQueue } from './data/jobqueue.js';
import { getProjectPool } from './data/projectpool.js';
import { ConfigIn, getConfig } from './data/config.js';

export default async function main(
  overrideConfig: Partial<ConfigIn>,
): Promise<void> {
  clear();
  console.log(
    chalk.yellow(figlet.textSync('JobQueue', { horizontalLayout: 'full' })),
  );

  const config = await getConfig(overrideConfig);
  const jobQueue = await getJobQueue(config.data.jobqueue);
  const projectPool = await getProjectPool(config.data.projectpool);
  console.log(); // New separation line

  try {
    while (true) {
      const action = await select({
        message: 'Select action',
        choices: actionNames.map((action) => {
          if (
            actionsDependentOnJobs.includes(action) &&
            jobQueue.data.queue.length === 0
          )
            return {
              name: action,
              value: action,
              disabled: '(Empty job queue)',
            };
          else if (
            actionsDependentOnProjects.includes(action) &&
            projectPool.data.pool.length === 0
          )
            return {
              name: action,
              value: action,
              disabled: '(Empty project pool)',
            };
          else return { name: action, value: action };
        }),
      });

      await actions[action](jobQueue, projectPool, config);

      console.log(); // New line for action seperation
    }
  } catch (error) {
    if (!(error instanceof ExitPromptError)) throw error;
  }
}
