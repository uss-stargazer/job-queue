import { JobQueueSchema } from './jobqueue.js';
import { ProjectPoolSchema } from './projectpool.js';
import {
  ConfigSchema,
  getDataPathFromConfig,
  toInputConfig,
} from './config.js';
import * as z from 'zod';
import { select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import { AbortError } from '../utils/index.js';
import chalk from 'chalk';
import { JsonData } from '../utils/jsonData.js';
import { haveUserUpdateData } from '../utils/promptUser.js';
import { GistData } from '../utils/gistData.js';

export const dataNames = ['jobqueue', 'projectpool', 'config'] as const;
export type DataName = (typeof dataNames)[number];
export const dataSchemas = {
  jobqueue: JobQueueSchema,
  projectpool: ProjectPoolSchema,
  config: ConfigSchema,
} as const satisfies { [N in DataName]: z.ZodType };
export type DataTypes = { [N in DataName]: z.infer<(typeof dataSchemas)[N]> };
type DataInWrappers = {
  [N in DataName]: JsonData<DataTypes[N]> | GistData<DataTypes[N]>;
};
export interface WrappedData extends DataInWrappers {
  config: JsonData<DataTypes['config']>;
  jobqueue: GistData<DataTypes['jobqueue']>;
  projectpool: GistData<DataTypes['projectpool']>;
}

export async function editData(
  data: WrappedData,
  configPath: string,
): Promise<void> {
  try {
    const target = await select({
      message: 'Select data to edit',
      choices: [
        { name: 'jobqueue.json', value: 'jobqueue' },
        { name: 'projectpool.json', value: 'projectpool' },
        { name: 'config.json', value: 'config' },
      ] as const,
    });
    const targetSchema = dataSchemas[target];
    const targetPath =
      target === 'config'
        ? configPath
        : getDataPathFromConfig(data.config.data[target]);

    await haveUserUpdateData<typeof targetSchema, 'in'>(
      targetSchema,
      target === 'config'
        ? toInputConfig(data[target].data)
        : data[target].data,
      {
        editor: data.config.data.editor,
        errorHead: 'Edit data failed',
        jsonSchemaUrl: data.config.data.schemas[target],
        file: { type: 'abs', path: targetPath },
      },
      {
        preparse(raw) {
          return raw.trim().length === 0
            ? { errMessage: 'Cannot delete data file.' }
            : 'continue';
        },
      },
    );
  } catch (error) {
    if (error instanceof AbortError || error instanceof ExitPromptError)
      console.log(chalk.red('[e]'), error.message);
    else throw error;
  }
}
