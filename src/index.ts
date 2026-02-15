import chalk from 'chalk';
import clear from 'clear';
import figlet from 'figlet';
import { search } from '@inquirer/prompts';
import { ExitPromptError, Separator } from '@inquirer/core';
import actions, {
  ActionName,
  actionNames,
  actionsDependentOnJobs,
  actionsDependentOnProjects,
} from './actions.js';
import { ConfigIn, getConfig, getDataPathFromConfig } from './data/config.js';
import { getJobQueue } from './data/jobqueue.js';
import { getProjectPool } from './data/projectpool.js';
import { dataNames, editData, WrappedData } from './data/index.js';
import { simpleDeepCompare } from './utils/index.js';
import dns from 'dns/promises';
import { inquirerConfirm } from './utils/promptUser.js';
import { isGistData } from './utils/gistData.js';

async function loadData(
  overrideConfigDir: string,
  overrideConfig: Partial<ConfigIn>,
  previousData?: WrappedData,
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
      config.data.editor,
    ),
    projectpool: await getProjectPool(
      getDataPathFromConfig(config.data.projectpool),
      config.data.schemas.projectpool,
      autoCreateOtherFiles,
      config.data.editor,
    ),
  };

  let connectionError: Error | null = undefined;
  for (const key of ['jobqueue', 'projectpool'] as const) {
    if (typeof config.data[key] === 'object') {
      if (
        previousData &&
        simpleDeepCompare(config.data[key], previousData.config.data[key])
      ) {
        if (key === 'jobqueue') data['jobqueue'] = previousData['jobqueue'];
        else if (key === 'projectpool')
          data['projectpool'] = previousData['projectpool'];
      } else {
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

        // Initial pull only if its changed (and user oks it if that's set in config)
        if (
          !config.data.confirmGistUpdates ||
          (await inquirerConfirm(`Pull gist for ${key}?`))
        ) {
          console.log(chalk.blue('[i]'), 'pulling', key);
          await data[key].pull();
        }
      }
    }
  }

  if (connectionError) {
    console.log(chalk.red('[e]'), connectionError.message);
    if (
      config.data.confirmOffline &&
      !(await inquirerConfirm('Continue offline?'))
    )
      throw connectionError;
    console.log(chalk.blue('[i]'), 'Continuing offline...');
  }

  return data;
}

async function syncData(data: WrappedData): Promise<void> {
  for (const key of dataNames) {
    await data[key].sync();

    if (
      isGistData(data[key]) &&
      data[key].isLinked &&
      (!data.config.data.confirmGistUpdates ||
        (await inquirerConfirm(`Push gist for ${key}?`)))
    ) {
      console.log(chalk.blue('[i]'), 'pushing', key);
      await data[key].push();
    }
  }
}

export default async function main(
  overrideConfigDir?: string,
  overrideConfig?: Partial<ConfigIn>,
): Promise<void> {
  let data = await loadData(overrideConfigDir, overrideConfig);

  if (data.config.data.showBanner ?? true) {
    if (data.config.data.showBanner === undefined) {
      clear();
      data.config.data.showBanner = false; // Don't show banner after first usage
    }

    console.log(
      chalk.yellow(figlet.textSync('JobQueue', { horizontalLayout: 'full' })),
    );
  }

  try {
    while (true) {
      // Get the desired action
      console.log(); // New line for action seperation
      const actionChoices = actionNames.map((action) => {
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
      });
      const action = await search<ActionName | 'editData' | 'syncData'>({
        message: 'Select action',
        source: (partialAction) => {
          const partialSet = new Set([...(partialAction?.toLowerCase() ?? [])]);
          const filteredActions =
            partialSet.size === 0
              ? actionChoices
              : actionChoices.filter((action) =>
                  partialSet.isSubsetOf(
                    new Set([...action.name.toLowerCase()]),
                  ),
                );
          const otherActions = [
            { name: 'editData', value: 'editData' },
            { name: 'syncData', value: 'syncData' },
          ] as const;
          return filteredActions.length > 0
            ? [...filteredActions, new Separator(), ...otherActions]
            : otherActions.filter((action) =>
                partialSet.isSubsetOf(new Set([...action.name.toLowerCase()])),
              );
        },
        pageSize: actionNames.length + 3,
      });

      // Do the action
      if (action === 'editData') {
        await editData(data, data.configPath);
        data = await loadData(overrideConfigDir, overrideConfig, data);
      } else if (action === 'syncData') {
        await syncData(data);
      } else await actions[action](data);
    }
  } catch (error) {
    if (!(error instanceof ExitPromptError)) throw error;
  }

  await syncData(data);
}
