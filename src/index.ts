import chalk from 'chalk';
import clear from 'clear';
import figlet from 'figlet';
import { confirm, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import actions, {
  actionNames,
  actionsDependentOnJobs,
  actionsDependentOnProjects,
} from './actions.js';
import { getJobQueue } from './data/jobqueue.js';
import { getProjectPool } from './data/projectpool.js';
import { Config, getConfig } from './data/config.js';
import { JsonData } from './data/utils.js';

interface Arguments {
  overridePaths: Partial<{ jobqueue: string; projectpool: string }>;
  overrideEditor?: string;
}

const updateConfig = async (
  config: JsonData<Config>,
  paths: Arguments['overridePaths'],
): Promise<void> => {
  const pathKeys = [...Object.keys(paths)] as (keyof typeof paths)[];
  if (pathKeys.some((key) => paths[key] && paths[key] !== config.data[key])) {
    const shouldUpdate = confirm({
      message:
        'Supplied path is different than in config. Want to update config?',
    });
    if (shouldUpdate) {
      pathKeys.forEach((key) => (config.data[key] = paths[key]));
      await config.sync();
    }
  }
};

export default async function main(args: Arguments): Promise<void> {
  clear();
  console.log(
    chalk.yellow(figlet.textSync('JobQueue', { horizontalLayout: 'full' })),
  );

  const config = await getConfig(args.overridePaths);
  const jobQueue = await getJobQueue(
    args.overridePaths.jobqueue ?? config.data.jobqueue,
  );
  const projectPool = await getProjectPool(
    args.overridePaths.projectpool ?? config.data.projectpool,
  );
  await updateConfig(config, args.overridePaths);
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

      await actions[action]({ jobQueue, projectPool }, args.overrideEditor);

      console.log(); // New line for action seperation
    }
  } catch (error) {
    if (!(error instanceof ExitPromptError)) throw error;
  }
}
