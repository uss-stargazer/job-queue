import * as z from 'zod';
import envPaths from 'env-paths';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { JsonData, makeJsonData } from './utils.js';
import { JobQueue } from './jobqueue.js';
import { ProjectPool } from './projectpool.js';
import chalk from 'chalk';

// Types / Schemas

export const ConfigSchema = z.object({
  jobqueue: z.string().optional(),
  projectpool: z.string().optional(),
  editor: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

// Methods

const defaultJobqueue: JobQueue = { queue: [] };
const defaultProjectpool: ProjectPool = { pool: [] };

export const getConfig = async (
  overridePaths: Partial<{ jobqueue: string; projectpath: string }>,
): Promise<JsonData<Config>> => {
  const configDir = path.resolve(envPaths('job-queue').config);
  const configPath = path.join(configDir, 'config.json');

  await fs.mkdir(configDir, { recursive: true });

  if (!existsSync(configPath)) {
    console.log(chalk.blue('[i]'), `Creating config at '${configPath}'...`);

    const defaultConfig: Config = {
      jobqueue:
        overridePaths.jobqueue ?? path.resolve(configDir, 'jobqueue.json'),
      projectpool:
        overridePaths.jobqueue ?? path.resolve(configDir, 'projectpool.json'),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaultConfigPairs: [keyof Config, any][] = [
      ['jobqueue', defaultJobqueue],
      ['projectpool', defaultProjectpool],
    ];
    for (const [key, obj] of defaultConfigPairs) {
      if (!existsSync(defaultConfig[key])) {
        console.log(
          chalk.blue('[i]'),
          `Creating initial ${key}.json at '${defaultConfig[key]}'...`,
        );
        await fs.writeFile(defaultConfig[key], JSON.stringify(obj));
      }
    }

    await fs.writeFile(configPath, JSON.stringify(defaultConfig));
  }

  return makeJsonData(configPath, ConfigSchema);
};
