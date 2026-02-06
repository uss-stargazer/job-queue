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
import { ConfigIn, getConfig } from './data/config.js';
import { getJobQueue } from './data/jobqueue.js';
import { getProjectPool } from './data/projectpool.js';
import { DataInJsonDatas } from './data/index.js';

export default async function main(
  overrideConfigDir?: string,
  overrideConfig?: Partial<ConfigIn>,
): Promise<void> {
  clear();
  console.log(
    chalk.yellow(figlet.textSync('JobQueue', { horizontalLayout: 'full' })),
  );

  const config = await getConfig(overrideConfigDir, overrideConfig);
  const data: DataInJsonDatas = {
    config: config,
    jobqueue: await getJobQueue(config.data.jobqueue),
    projectpool: await getProjectPool(config.data.projectpool),
  };
  console.log(); // New separation line

  try {
    while (true) {
      const action = await select({
        message: 'Select action',
        choices: actionNames.map((action) => {
          if (
            actionsDependentOnJobs.includes(action) &&
            data.jobqueue.data.queue.length === 0
          )
            return {
              name: action,
              value: action,
              disabled: '(Empty job queue)',
            };
          else if (
            actionsDependentOnProjects.includes(action) &&
            data.projectpool.data.pool.length === 0
          )
            return {
              name: action,
              value: action,
              disabled: '(Empty project pool)',
            };
          else return { name: action, value: action };
        }),
      });

      await actions[action](data);

      console.log(); // New line for action seperation
    }
  } catch (error) {
    if (!(error instanceof ExitPromptError)) throw error;
  }
}
