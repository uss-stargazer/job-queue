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
import {
  Config,
  ConfigIn,
  getConfig,
  getDataPathFromConfig,
} from './data/config.js';
import { getJobQueue } from './data/jobqueue.js';
import { getProjectPool } from './data/projectpool.js';
import { editData, WrappedData } from './data/index.js';
import { simpleDeepCompare } from './utils/index.js';
import dns from 'dns/promises';

async function loadData(
  overrideConfigDir: string,
  overrideConfig: Partial<ConfigIn>,
  previousConfig?: Config,
): Promise<
  WrappedData & {
    configPath: string;
  }
> {
  const {
    config,
    path: configPath,
    hadToCreate: autoCreateOtherFiles,
  } = await getConfig(overrideConfigDir, overrideConfig);

  const data = {
    config,
    configPath,
    jobqueue: await getJobQueue(
      getDataPathFromConfig(config.data.jobqueue),
      config.data.schemas.jobqueue,
      autoCreateOtherFiles,
    ),
    projectpool: await getProjectPool(
      getDataPathFromConfig(config.data.projectpool),
      config.data.schemas.projectpool,
      autoCreateOtherFiles,
    ),
  };

  let connectionError: Error | null = undefined;
  for (const key of ['jobqueue', 'projectpool'] as const) {
    if (
      typeof config.data[key] === 'object' &&
      (!previousConfig ||
        !simpleDeepCompare(config.data[key], previousConfig[key]))
    ) {
      // Online check connection if its required for a gist and it hasn't already been checked
      if (connectionError === undefined) {
        const resolved = await dns
          .resolve('github.com')
          .catch(
            (error) => new Error(`Could not resolve github.com: ${error}`),
          );
        connectionError = resolved instanceof Error ? resolved : null;
        if (connectionError) break;
      }

      await data[key].linkGist({
        id: config.data[key].ghGistId,
        accessToken: config.data[key].ghAccessToken,
      });
      console.log(chalk.blue('[i]'), 'initial pull of', key);
      await data[key].pull(); // TODO: try catch needed here?
    }
  }

  if (connectionError) {
    console.log(chalk.red('[e]'), connectionError.message);
    console.log(chalk.blue('[i]'), 'Continuing offline...');
  }

  return data;
}

async function pushGistData(data: WrappedData): Promise<void> {
  for (const key of ['jobqueue', 'projectpool'] as const) {
    if (data[key].isLinked) {
      console.log(chalk.blue('[i]'), 'on exit, pushing data for', key);
      await data[key].push(); // TODO: try catch needed here?
    }
  }
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
        data = await loadData(
          overrideConfigDir,
          overrideConfig,
          data.config.data,
        );
      } else await actions[action](data);

      console.log(); // New line for action seperation
    }
  } catch (error) {
    if (!(error instanceof ExitPromptError)) throw error;
  }

  await pushGistData(data);
}
