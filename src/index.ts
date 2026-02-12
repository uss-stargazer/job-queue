import chalk from 'chalk';
import clear from 'clear';
import figlet from 'figlet';
import { select } from '@inquirer/prompts';
import { ExitPromptError, Separator } from '@inquirer/core';
import actions, {
  ActionName,
  actionNames,
  actionsDependentOnJobs,
  actionsDependentOnProjects,
} from './actions.js';
import { ConfigIn, getConfig } from './data/config.js';
import { getJobQueue } from './data/jobqueue.js';
import { getProjectPool } from './data/projectpool.js';
import { DataInJsonDatas, editData } from './data/index.js';

async function loadData(
  overrideConfigDir: string,
  overrideConfig: Partial<ConfigIn>,
): Promise<
  DataInJsonDatas & {
    configPath: string;
  }
> {
  const {
    config,
    path: configPath,
    hadToCreate: autoCreateOtherFiles,
  } = await getConfig(overrideConfigDir, overrideConfig);

  return {
    config,
    configPath,
    jobqueue: await getJobQueue(
      config.data.jobqueue,
      config.data.schemas.jobqueue,
      autoCreateOtherFiles,
    ),
    projectpool: await getProjectPool(
      config.data.projectpool,
      config.data.schemas.projectpool,
      autoCreateOtherFiles,
    ),
  };
}

export default async function main(
  overrideConfigDir?: string,
  overrideConfig?: Partial<ConfigIn>,
): Promise<void> {
  clear();
  console.log(
    chalk.yellow(figlet.textSync('JobQueue', { horizontalLayout: 'full' })),
  );

  let data = await loadData(overrideConfigDir, overrideConfig);
  console.log(); // New separation line

  try {
    while (true) {
      const action = await select<ActionName | 'editData'>({
        message: 'Select action',
        choices: [
          ...actionNames.map((action) => {
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
          new Separator(),
          { name: 'editData', value: 'editData' },
        ],
      });

      if (action === 'editData') {
        await editData(data, data.configPath);
        data = await loadData(overrideConfigDir, overrideConfig);
      } else await actions[action](data);

      console.log(); // New line for action seperation
    }
  } catch (error) {
    if (!(error instanceof ExitPromptError)) throw error;
  }
}
