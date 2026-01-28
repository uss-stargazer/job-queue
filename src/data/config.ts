import * as z from 'zod';
import envPaths from 'env-paths';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { JsonData, makeJsonData } from './utils.js';
import chalk from 'chalk';
import { JobQueue, JobQueueSchema, JobSchema } from './jobqueue.js';
import {
  ProjectPool,
  ProjectPoolSchema,
  ProjectSchema,
} from './projectpool.js';
import { confirm } from '@inquirer/prompts';
import { fileURLToPath, pathToFileURL } from 'url';

// Types / Schemas

const jsonSchemaNames = [
  'job',
  'jobqueue',
  'project',
  'projectpool',
  'config',
] as const;
type JsonSchemaName = (typeof jsonSchemaNames)[number];

const NonemptyString = z.string().nonempty();
// prettier-ignore
export const ConfigSchema = z.object({
  jobqueue: NonemptyString.optional().meta({title: "Jobqueue path", description: "Path to jobqueue.json."}),
  projectpool: NonemptyString.optional().meta({title: "Projectpool path", description: "Path to projectpool.json."}),
  editor: NonemptyString.optional().meta({title: "Editor command", description: "Command to run editor. Will be run like `<editor> /some/data.json` so make sure it waits."}),

  // schemas stored as path to schemas dir, but expanded on parse
  schemas: NonemptyString.meta({title: "Schemas directory", description: `Path to directory containing: ${jsonSchemaNames.map(base => `${base}.schema.json`).join(", ")}.`}).transform(
    (schemasDir) => Object.fromEntries(
      jsonSchemaNames.map((base) => [base, pathToFileURL(path.resolve(schemasDir, `${base}.schema.json`)).href])
    ) as {[K in JsonSchemaName]: string}
  ),
});
export type ConfigIn = z.input<typeof ConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

const jsonSchemas: { [K in JsonSchemaName]: z.ZodType } = {
  job: JobSchema,
  jobqueue: JobQueueSchema,
  project: ProjectSchema,
  projectpool: ProjectPoolSchema,
  config: ConfigSchema,
} as const;

// Methods

const updateNestedObject = async <T extends { [key: string]: any }>( // eslint-disable-line @typescript-eslint/no-explicit-any
  base: T,
  update: Partial<T>,
): Promise<void> => {
  const keys = [...Object.keys(update)] as (keyof typeof update)[];
  for (const key of keys) {
    if (
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      await updateNestedObject(base[key], update[key]);
    } else {
      const shouldUpdate = await confirm({
        message: `Supplied '${key.toString()}' is different than in config. Want to update config?`,
      });
      if (shouldUpdate) base[key] = update[key];
    }
  }
};

const defaultData: { jobqueue: JobQueue; projectpool: ProjectPool } = {
  jobqueue: { queue: [] },
  projectpool: { pool: [] },
};

const createConfig = async (
  configDir: string,
  override: Partial<ConfigIn>,
): Promise<{ encoded: ConfigIn; decoded: Config }> => {
  const config: ConfigIn = {
    jobqueue: path.resolve(configDir, 'jobqueue.json'),
    projectpool: path.resolve(configDir, 'projectpool.json'),
    schemas: path.resolve(configDir, 'schemas'),
    ...override,
  };
  const decodedConfig = ConfigSchema.decode(config);

  // jobqueue and projectpool paths
  for (const key of ['jobqueue', 'projectpool'] as const) {
    if (!existsSync(config[key])) {
      console.log(
        chalk.blue('[i]'),
        `Creating ${path.join('{config}', path.relative(configDir, config[key]))}...`,
      );
      await fs.writeFile(
        config[key],
        JSON.stringify(
          {
            $schema: decodedConfig.schemas[key],
            ...defaultData[key],
          },
          undefined,
          '  ',
        ),
      );
    }
  }

  // schemas
  await fs.mkdir(config.schemas);
  for (const schema of jsonSchemaNames) {
    if (!existsSync(decodedConfig.schemas[schema])) {
      console.log(
        chalk.blue('[i]'),
        `Creating ${path.join('{config}', path.relative(configDir, decodedConfig.schemas[schema]))}...`,
      );
      await fs.writeFile(
        decodedConfig.schemas[schema],
        JSON.stringify(
          jsonSchemas[schema].toJSONSchema({
            io: 'input',
            unrepresentable: 'throw',
          }),
          undefined,
          '  ',
        ),
      );
    }
  }

  return { encoded: config, decoded: decodedConfig };
};

const checkConfig = (config: Config, configPath: string): void => {
  try {
    [
      config.jobqueue,
      config.projectpool,
      ...Object.values(config.schemas),
    ].forEach((file) => {
      if (!existsSync(/^file:\/\/\//.test(file) ? fileURLToPath(file) : file))
        throw new Error(`File '${file}' in config does not exist`);
    });
  } catch (error) {
    throw new Error(`Config at '${configPath}'.\n${error}`);
  }
};

export const getConfig = async (
  overrideConfig: Partial<ConfigIn>,
): Promise<JsonData<Config>> => {
  const configDir = path.resolve(envPaths('job-queue').config);
  const configPath = path.resolve(configDir, 'config.json');

  await fs.mkdir(configDir, { recursive: true });

  if (!existsSync(configPath)) {
    console.log(chalk.blue('[i]'), `Creating config at '${configPath}'...`);
    const { encoded: config, decoded: decodedConfig } = await createConfig(
      configDir,
      overrideConfig,
    );
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          $schema: decodedConfig.schemas['config'],
          ...config,
        },
        undefined,
        '  ',
      ),
    );
  }

  const configData = await makeJsonData(configPath, ConfigSchema);
  checkConfig(configData.data, configPath);

  await updateNestedObject(
    configData.data,
    ConfigSchema.partial().decode(overrideConfig),
  );

  return configData;
};
