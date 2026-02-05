import * as z from 'zod';
import envPaths from 'env-paths';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { JsonData, makeJsonData } from '../utils/jsonData.js';
import chalk from 'chalk';
import { JobQueue, JobQueueSchema, JobSchema } from './jobqueue.js';
import {
  ProjectPool,
  ProjectPoolSchema,
  ProjectSchema,
} from './projectpool.js';
import { confirm } from '@inquirer/prompts';
import { fileURLToPath, pathToFileURL } from 'url';
import pkg from '../../package.json' with { type: 'json' };

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
// !!! NOTE !!! Whenever you change this schema, PLEASE update package.json version (so JSON schemas will get updated automatically)
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
export const toInputConfig = (outputData: Config): ConfigIn => {
  const schemaDir = Object.values(outputData.schemas).reduce(
    (schemaDir, schemaPath) => {
      const thisSchemaDir = path.dirname(fileURLToPath(schemaPath));
      return schemaDir === null || schemaDir === thisSchemaDir
        ? thisSchemaDir
        : ((): never => {
            throw new Error(
              'Decoded invidual schemas are not in the same directory.',
            );
          })();
    },
    null,
  );
  return { ...outputData, schemas: schemaDir };
};

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

// JSON schema methods

const getJsonSchemaId = (schemaFileUrl): string =>
  path.posix.join(pkg.version, path.basename(fileURLToPath(schemaFileUrl)));

const versionFromJsonSchemaId = (id): string => path.dirname(id);

const updateJsonSchema = async (
  schemaSchema: z.ZodType,
  schemaFileUrl: string,
): Promise<void> => {
  const schemaPath = fileURLToPath(schemaFileUrl);
  const schemaDir = path.dirname(schemaPath);
  if (!existsSync(schemaDir)) await fs.mkdir(schemaDir, { recursive: true });
  return await fs.writeFile(
    schemaPath,
    JSON.stringify(
      {
        $id: getJsonSchemaId(schemaFileUrl),
        ...schemaSchema.toJSONSchema({
          io: 'input',
          unrepresentable: 'throw',
        }),
      },
      undefined,
      '  ',
    ),
  );
};

// Config methods

const defaultData: { jobqueue: JobQueue; projectpool: ProjectPool } = {
  jobqueue: { queue: [] },
  projectpool: { pool: [] },
};

const createConfig = async (
  configDir: string,
  override?: Partial<ConfigIn>,
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
  if (!existsSync(config.schemas)) await fs.mkdir(config.schemas);
  for (const schema of jsonSchemaNames) {
    if (!existsSync(decodedConfig.schemas[schema])) {
      console.log(
        chalk.blue('[i]'),
        `Creating ${path.join('{config}', path.relative(configDir, fileURLToPath(decodedConfig.schemas[schema])))}...`,
      );
      await updateJsonSchema(
        jsonSchemas[schema],
        decodedConfig.schemas[schema],
      );
    }
  }

  return { encoded: config, decoded: decodedConfig };
};

const checkConfig = async (
  config: Config,
  configPath: string,
): Promise<void> => {
  try {
    // Make sure jobqueue and project pool exist and create if not
    for (const key of ['jobqueue', 'projectpool']) {
      if (!existsSync(config[key]))
        if (
          ['jobqueue', 'projectpool'].includes(key) &&
          (await confirm({
            message: `File at config.${key} does not exist. Want to create it?`,
          }))
        )
          await fs.writeFile(
            config[key],
            JSON.stringify(
              {
                $schema: config.schemas[key],
                ...defaultData[key],
              },
              undefined,
              '  ',
            ),
          );
        else throw new Error(`File '${config[key]}' in config does not exist`);
    }

    // Make sure each schema exists and is the correct version
    const outdatedSchemas: JsonSchemaName[] = [];
    for (const schema of Object.keys(
      config.schemas,
    ) as (keyof typeof config.schemas)[]) {
      const schemaPath = fileURLToPath(config.schemas[schema]);
      if (existsSync(schemaPath)) {
        const schemaJson = JSON.parse(
          await fs.readFile(schemaPath, {
            encoding: 'utf8',
          }),
        );

        const version =
          schemaJson.$id && versionFromJsonSchemaId(schemaJson.$id);
        if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
          console.log(
            chalk.yellow('[w]'),
            `${path.join('{config}', path.basename(config.schemas[schema]))} is malformed. Overwriting...`,
          );
          await updateJsonSchema(jsonSchemas[schema], config.schemas[schema]);
        } else if (version !== pkg.version) {
          outdatedSchemas.push(schema);
        }
      } else {
        console.log(
          chalk.blue('[i]'),
          `${path.join('{config}', path.basename(config.schemas[schema]))} does not exist. Creating...`,
        );
        await updateJsonSchema(jsonSchemas[schema], config.schemas[schema]);
      }
    }
    if (outdatedSchemas.length > 0) {
      const shouldUpdate = await confirm({
        message:
          'You are using at least one outdated JSON schema. Want to regenerate them?',
      });
      if (shouldUpdate)
        outdatedSchemas.forEach((schema) =>
          updateJsonSchema(jsonSchemas[schema], config.schemas[schema]),
        );
    }
  } catch (error) {
    throw new Error(`${error}\nFix config at '${configPath}'.`);
  }
};

export const getConfig = async (
  overrideConfigDir?: string,
  overrideConfig?: Partial<ConfigIn>,
): Promise<{ config: JsonData<Config>; path: string }> => {
  const configDir =
    overrideConfigDir ?? path.resolve(envPaths('job-queue').config);
  const configPath = path.resolve(configDir, 'config.json');

  if (!existsSync(configDir)) await fs.mkdir(configDir, { recursive: true });

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

  const configData = await makeJsonData(
    configPath,
    ConfigSchema,
    toInputConfig,
  );
  await checkConfig(configData.data, configPath);

  await updateNestedObject(
    configData.data,
    ConfigSchema.partial().decode(overrideConfig),
  );

  return { config: configData, path: configPath };
};
