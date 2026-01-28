import { confirm } from '@inquirer/prompts';
import * as z from 'zod';
import { haveUserUpdateData, JsonData, makeJsonData } from './utils.js';
import { JobQueue } from './jobqueue.js';
import { Config } from './config.js';

// Types / Schemas

// prettier-ignore
export const ProjectSchema = z.object({
  name: z.string().trim().nonempty().meta({title: 'Project name', description: 'Name of the project. Used as identifier.'}),
  description: z.string().optional().meta({title: 'Project description', description: 'Longer description of the project. For your benefit, optional.'}),
  repo: z.url().optional().meta({title: 'Project repository', description: 'URL to project repository. For your benefit, optional.'}),
  status: z.enum(['active', 'inactive', 'complete']).meta({title: 'Project status', description: "Status of this project. 'active': they are referenced in jobqueue.json, 'inactive': they aren't referenced anywhere and aren't done, 'complete': they're done."}),
}).meta({title: 'Project', description: 'A single project entry for JobQueue (usually matches up with a GitHub repo, if you use that).'});
export type Project = z.infer<typeof ProjectSchema>;
// prettier-ignore
export const ProjectPoolSchema = z.object({
  pool: z.array(ProjectSchema).meta({description: 'Set of projects, works in progress or just ideas.'}),
}).meta({title: 'Root project pool', description: 'Root object for pool of projects.'});
export type ProjectPool = z.infer<typeof ProjectPoolSchema>;

// Methods

export const getProjectPool = async (
  jsonPath: string,
): Promise<JsonData<ProjectPool>> =>
  await makeJsonData(jsonPath, ProjectPoolSchema);

export const checkProjectName = (name: string, projects: Project[]): boolean =>
  projects.some((project) => project.name === name);

export const updateProject = async (
  project: Project,
  projectPool: JsonData<ProjectPool>,
  jobQueue: JsonData<JobQueue>,
  config: Config,
): Promise<Project | 'deleted'> => {
  const pool = projectPool.data.pool;
  const jobsReferencingProject = jobQueue.data.queue.filter(
    (job) => job.project === project.name,
  );

  let userDeletedProject = false;
  const updatedProject = await haveUserUpdateData(
    ProjectSchema,
    project,
    {
      editor: config.editor,
      errorHead: 'Rejected project',
      tmpPrefix: 'jobqueue-project',
      tooltips: [
        'Opening project JSON in editor for editing.',
        'Delete file contents to delete the project.',
      ],
      jsonSchemaUrl: config.schemas.project,
    },
    {
      preparse(rawContents) {
        // Check if user deleted the project
        if (rawContents.trim().length === 0) {
          userDeletedProject = true;
          return 'pass';
        }
        return 'continue';
      },
      postparse(updatedProject) {
        if (
          updatedProject.name !== project.name &&
          checkProjectName(updatedProject.name, pool)
        )
          return {
            errMessage: `new name '${updatedProject.name}' already exists in pool`,
          };
        if (
          jobsReferencingProject.length > 0 &&
          updatedProject.status !== 'active'
        )
          return {
            errMessage: `status can not be set to ${updatedProject.status}: jobs in queue still reference project`,
          };
        return 'continue';
      },
    },
  );

  // Check if user wants to rename referencing jobs
  if (
    !userDeletedProject &&
    updatedProject.name !== project.name &&
    jobsReferencingProject.length > 0
  ) {
    const renameJobReferences = await confirm({
      message: `You are changing this project's name to ${updatedProject.name}. Would you like to rename the project entry in referencing jobs?`,
    });
    if (renameJobReferences) {
      jobsReferencingProject.forEach((job) => {
        job.project = updatedProject.name;
      });
      await jobQueue.sync();
    }
  }

  return userDeletedProject ? 'deleted' : updatedProject;
};
