# Job Queue

The concept is modeling your todo-list as bite-sized jobs in a First-In, First-Out (FIFO) queue.
The goal is to increase productivity.

- Small jobs that do one thing at a time are more manageable, and make Git commits easier
- Documenting todo in manageable fashion decreases liklihood of abandoning a project

## Install

Can be installed system-wide if you have Node/NPM installed:

```
npm install --global @uss-stargazer/job-queue
```

Then, you can use like:

```
job-queue --help
# or 
jobq --help
```

## Workflow

- _\[Daemon\]_ Spontaneous, not fleshed out ideas get immediately added to the project pool as "inactive".
- You should generally have an idea of a few projects you want to focus on at a time. For each, push
  jobs to the jobqueue that do a **_single thing_** (ideally no more; they should be contained in a
  single Git commit).
- Work (while you haven't finished the projects you're focusing on)
  - Go through job queue and remove jobs when complete (committing as you go).
  - _\[Daemon\]_ While not on the terminal, think of next jobs, then push to queue.
