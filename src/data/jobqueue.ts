import * as z from 'zod';
import { JsonData, makeJsonData } from '../utils/jsonData.js';
import { checkProjectName, ProjectPool } from './projectpool.js';
import { Config } from './config.js';
import { clearNLines } from '../utils/index.js';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import path from 'path';
import { haveUserUpdateData } from '../utils/promptUser.js';

// Types / Schemas

// prettier-ignore
export const JobSchema = z.object({
  name: z.string().trim().nonempty().meta({title: 'Job name', description: 'Short name of the job (think a single commit message). Used as job identifier.'}),
  objectivies: z.array(z.string().trim().nonempty()).meta({title: 'Job objectivies', description: 'A list of objectives to complete for this job. Purely for your benefit.'}),
  updates: z.string().optional().meta({title: 'Job updates', description: "Put any notes/updates to the job here while you're working. Optional."}),
  project: z.string().trim().nonempty().meta({title: 'Associated project', description: 'Corresponding project ID in projectpool.json.'}),
}).meta({ title: 'Job', description: 'A single job entry for JobQueue.' });
export type Job = z.infer<typeof JobSchema>;
// prettier-ignore
export const JobQueueSchema = z.object({
  queue: z.array(JobSchema).meta({ title: 'Job queue' }),
}).meta({title: 'Job queue root', description: 'Root object for jobs/tasks FIFO queue model.'});
export type JobQueue = z.infer<typeof JobQueueSchema>;

const defaultJobQueue: JobQueue = { queue: [] };

// Methods

export const getJobQueue = async (
  jsonPath: string,
  jsonSchemaUrl: string,
  autoCreateFiles: boolean = false,
): Promise<JsonData<JobQueue>> => {
  if (!existsSync(jsonPath)) {
    console.log(
      chalk.red('[e]'),
      `File for jobqueue.json at '${jsonPath}' does not exist.`,
    );
    if (
      autoCreateFiles ||
      (await confirm({
        message: `Want to create it?`,
      }).finally(() => clearNLines(1)))
    ) {
      clearNLines(1);
      console.log(chalk.blue('[i]'), `Creating ${jsonPath}...`);

      await fs.mkdir(path.dirname(jsonPath), { recursive: true });
      await fs.writeFile(
        jsonPath,
        JSON.stringify(
          {
            $schema: jsonSchemaUrl,
            ...defaultJobQueue,
          },
          undefined,
          '  ',
        ),
      );
    } else
      throw new Error(`File '${jsonPath}' for jobqueue.json does not exist`);
  }

  return await makeJsonData(jsonPath, JobQueueSchema, jsonSchemaUrl).catch(
    (error) => {
      if (error instanceof SyntaxError) {
        console.log(chalk.red('[e]'), `Invalid JSON at '${jsonPath}'`);
      } else if (error instanceof z.ZodError) {
        console.log(
          chalk.red('[e]'),
          `JSON at '${jsonPath}' does not match schema:\n${z.prettifyError(error)}`,
        );
      } else throw error;

      return confirm({ message: 'Want to overwrite with default?' }).then(
        (shouldContinue) => {
          if (!shouldContinue) {
            console.log('throwing an err');
            throw error;
          } else return undefined;
        },
      );
    },
  );
};

export const updateJob = async (
  job: Job,
  projectPool: JsonData<ProjectPool>,
  config: Config,
): Promise<Job | 'deleted'> => {
  const pool = projectPool.data.pool;

  let userDeletedJob = false;
  const updatedJob = await haveUserUpdateData(
    JobSchema,
    job,
    {
      editor: config.editor,
      errorHead: 'Rejected job',
      file: { type: 'tmp', prefix: 'jobqueue-job' },
      tooltips: [
        'Opening job JSON in editor for editing.',
        'Delete file contents to finish the job.',
      ],
      jsonSchemaUrl: config.schemas.job,
    },
    {
      preparse(rawContents) {
        // Check if user deleted the job
        if (rawContents.trim().length === 0) {
          userDeletedJob = true;
          return 'pass';
        }
        return 'continue';
      },
      postparse(job) {
        return checkProjectName(job.project, pool)
          ? 'continue'
          : {
              errMessage: `invalid project name: '${job.project}' not in project pool`,
            };
      },
    },
  );

  if (!userDeletedJob) {
    // Make sure corresponding project is set to active
    const jobProject = pool.find(
      (project) => project.name === updatedJob.project,
    );
    if (jobProject.status !== 'active') {
      jobProject.status = 'active';
      await projectPool.sync();
    }
  }

  return userDeletedJob ? 'deleted' : updatedJob;
};
