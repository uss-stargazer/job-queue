import { JobQueueSchema } from './jobqueue.js';
import { ProjectPoolSchema } from './projectpool.js';
import { ConfigSchema, toInputConfig } from './config.js';
import * as z from 'zod';
import { select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import { AbortError } from '../utils/index.js';
import chalk from 'chalk';
import { JsonData } from '../utils/jsonData.js';
import { haveUserUpdateData } from '../utils/promptUser.js';

export const dataNames = ['jobqueue', 'projectpool', 'config'] as const;
export type DataName = (typeof dataNames)[number];
export const dataSchemas = {
  jobqueue: JobQueueSchema,
  projectpool: ProjectPoolSchema,
  config: ConfigSchema,
} as const satisfies { [N in DataName]: z.ZodType };
export type DataTypes = { [N in DataName]: z.infer<(typeof dataSchemas)[N]> };
export type DataInJsonDatas = { [N in DataName]: JsonData<DataTypes[N]> };

export async function editData(
  data: DataInJsonDatas,
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
      target === 'config' ? configPath : data.config.data[target];

    data[target].data = await haveUserUpdateData<typeof targetSchema, 'in'>(
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

    await data[target].sync();
  } catch (error) {
    if (error instanceof AbortError || error instanceof ExitPromptError)
      console.log(chalk.red('[e]'), error.message);
    else throw error;
  }
}
