import * as z from 'zod';
import { haveUserUpdateData, JsonData } from './utils.js';
import { checkProjectName, ProjectPoolSchema } from './projectpool.js';

// Types / Schemas

export const JobSchema = z.object({
  name: z.string().trim().nonempty(),
  objectivies: z.array(z.string().trim().nonempty()),
  updates: z.string().optional(),
  project: z.string().trim().nonempty(),
});
export type Job = z.infer<typeof JobSchema>;
export const JobQueueSchema = z.object({
  queue: z.array(JobSchema),
});

// Methods

export const updateJob = async (
  job: Job,
  projectPool: JsonData<typeof ProjectPoolSchema>,
  editor?: string,
): Promise<Job | 'deleted'> => {
  const pool = projectPool.data.pool;

  let userDeletedJob = false;
  const updatedJob = await haveUserUpdateData(
    JobSchema,
    job,
    {
      editor,
      errorHead: 'Rejected job',
      tmpPrefix: 'jobqueue-job',
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
