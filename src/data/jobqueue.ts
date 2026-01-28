import * as z from 'zod';
import { haveUserUpdateData, JsonData, makeJsonData } from './utils.js';
import { checkProjectName, ProjectPool } from './projectpool.js';
import { Config } from './config.js';

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

// Methods

export const getJobQueue = async (
  jsonPath: string,
): Promise<JsonData<JobQueue>> => await makeJsonData(jsonPath, JobQueueSchema);

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
      tmpPrefix: 'jobqueue-job',
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
