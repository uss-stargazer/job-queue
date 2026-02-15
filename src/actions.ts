import chalk from 'chalk';
import { confirm, search } from '@inquirer/prompts';
import sortableCheckbox from './utils/sortableCheckbox.js';
import { AbortError, reorder } from './utils/index.js';
import { Job, updateJob } from './data/jobqueue.js';
import { Project, updateProject } from './data/projectpool.js';
import { WrappedData } from './data/index.js';
import { ExitPromptError } from '@inquirer/core';

export const actionNames = [
  'dequeueJob',
  'enqueueJob',
  'editQueue',
  'addProject',
  'editProject',
] as const;

export type ActionName = (typeof actionNames)[number];

export const actionsDependentOnJobs: ActionName[] = ['dequeueJob', 'editQueue'];
export const actionsDependentOnProjects: ActionName[] = [
  'enqueueJob',
  'editProject',
];

const actions: {
  [K in ActionName]: (data: WrappedData) => Promise<void>;
} = {
  dequeueJob: async ({ jobqueue, projectpool, config }) => {
    const queue = jobqueue.data.queue;
    const job = queue.shift();

    if (job === undefined) {
      console.log(chalk.red('[e]'), 'No jobs in queue.');
      return;
    }

    try {
      const updatedJob = await updateJob(job, projectpool, config.data);
      if (updatedJob !== 'deleted') {
        queue.unshift(updatedJob);
        console.log(chalk.blue('[i]'), 'Job edited');
      } else {
        console.log(chalk.green('✔'), 'Job completed and deleted');
      }

      await jobqueue.sync();
    } catch (error) {
      if (!(error instanceof AbortError)) throw error;

      console.log(chalk.red('[e]'), error.message);
      queue.unshift(job);
    }
  },

  enqueueJob: async ({ jobqueue, projectpool, config }) => {
    if (projectpool.data.pool.length === 0) {
      console.log(chalk.red('[e]'), 'No projects in pool to make job for.');
      return;
    }

    const queue = jobqueue.data.queue;
    const placeholderJob: Job = {
      name: '[placeholder]',
      objectivies: [
        'Put the thing in the thing.',
        'Make sure that thing works.',
      ],
      project: '[some-project]',
      updates: 'Put notes here.',
    };

    try {
      const job = await updateJob(placeholderJob, projectpool, config.data);
      if (job === 'deleted') throw new AbortError('Enqueue aborted');

      queue.push(job);
      console.log(chalk.green('✔'), 'Job enqueued');
      await jobqueue.sync();
    } catch (error) {
      if (!(error instanceof AbortError)) throw error;
      console.log(chalk.red('[e]'), error.message);
    }
  },

  editQueue: async ({ jobqueue, projectpool, config }) => {
    const queue = jobqueue.data.queue;
    if (queue.length === 0) {
      console.log(chalk.red('[e]'), 'No jobs in queue.');
      return;
    }

    const reorderedQueueIdxs = await sortableCheckbox({
      message: 'Reorder queue and/or select jobs to edit',
      choices: queue.map((job, jobIdx) => ({
        name: `[${job.project}] ${job.name}`,
        value: jobIdx,
      })),
    });

    reorder(
      queue,
      reorderedQueueIdxs.map(({ value: jobIdx }) => jobIdx),
    );
    console.log(chalk.green('✔'), 'Queue reordered.');

    // Open checked activities for editing

    const checkedActivities = reorderedQueueIdxs
      .map(({ checked }, jobIdx) => ({ checked, jobIdx }))
      .filter(({ checked }) => checked);

    if (checkedActivities.length > 0) {
      for (
        let checkedIdx = 0;
        checkedIdx < checkedActivities.length;
        checkedIdx++
      ) {
        const jobIdx = checkedActivities[checkedIdx].jobIdx;

        try {
          const job = queue[jobIdx];
          const updatedJob = await updateJob(job, projectpool, config.data);
          if (updatedJob === 'deleted') {
            queue.splice(jobIdx, 1);
            console.log(chalk.green('✔'), `Job '${job.name}' deleted.`);
          } else {
            queue[jobIdx] = updatedJob;
            console.log(chalk.green('✔'), `Job '${updatedJob.name}' edited.`);
          }

          await jobqueue.sync();
        } catch (error) {
          if (!(error instanceof AbortError)) throw error;

          console.log(chalk.red('[e]'), error.message);
          if (
            checkedIdx + 1 < checkedActivities.length &&
            (await confirm({ message: 'Abort all edits?' }))
          )
            break;
        }
      }
    }
  },

  addProject: async ({ jobqueue, projectpool, config }) => {
    const pool = projectpool.data.pool;
    const placeholderProject: Project = {
      name: '[some-project]',
      description: 'This is a placeholder project.',
      repo: 'https://some.project.com/project',
      status: 'inactive',
    };

    try {
      const project = await updateProject(
        placeholderProject,
        projectpool,
        jobqueue,
        config.data,
      );
      if (project === 'deleted') throw new AbortError('Add project aborted');

      pool.push(project);
      console.log(chalk.green('✔'), 'Added new project');
      await projectpool.sync();
    } catch (error) {
      if (!(error instanceof AbortError)) throw error;

      console.log(chalk.red('[e]'), error.message);
    }
  },

  editProject: async ({ jobqueue, projectpool, config }) => {
    const pool = projectpool.data.pool;
    if (pool.length === 0) {
      console.log(chalk.red('[e]'), 'No projects in pool.');
      return;
    }

    // Get project name to edit

    let projectName;
    try {
      projectName = await search({
        message: 'Enter the name of the project to edit',
        source: (partialProjectName) => {
          const projectNames = pool.map((project) => project.name);
          if (!partialProjectName) return projectNames;

          const partialSet = new Set([...partialProjectName]);
          return projectNames.filter((projectName) =>
            partialSet.isSubsetOf(new Set([...projectName])),
          );
        },
      });
    } catch (error) {
      if (!(error instanceof ExitPromptError)) throw error;
      throw new AbortError('editProject aborted');
    }

    const projectIdx = pool.findIndex(
      (project) => project.name === projectName,
    );
    if (projectIdx < 0) throw new Error('Invalid project name');
    const [project] = pool.splice(projectIdx, 1);

    // Do the editing

    try {
      const updatedProject = await updateProject(
        project,
        projectpool,
        jobqueue,
        config.data,
      );
      if (updatedProject !== 'deleted') {
        pool.push(updatedProject);
        console.log(chalk.green('✔'), 'Project edited');
      } else {
        console.log(chalk.green('✔'), 'Project deleted');
      }

      await projectpool.sync();
    } catch (error) {
      if (!(error instanceof AbortError)) throw error;

      console.log(chalk.red('[e]'), error.message);
      pool.push(project);
    }
  },
} as const;

export default actions;
