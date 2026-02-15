# job-queue

The concept is modeling your todo-list as bite-sized jobs in a First-In, First-Out (FIFO) queue.
The goal is to increase productivity.

- Small jobs that do one thing at a time are more manageable, and make Git commits easier
- Documenting todo in manageable fashion decreases liklihood of abandoning a project

## Install

Can be installed system-wide if you have NodeJS installed:

```
npm install --global @uss-stargazer/job-queue
```

Then, you can use like:

```
job-queue --help
# or 
jobq --help
```

## Usage

***TLDR***: The CLI tries to be user friendly, so just use it...

It's just based on a few files: config.json, jobqueue.json, and projectpool.json. Strives to be
a bit like Git in the sense that it opens data structures in the user's editor for updating data.

### JSON schemas

It's recommended that you use an editor or editor plugin with some sort of intellisense for JSON 
schemas, as it makes it much easier to work with.

If this isn't available, the expected structures can be found in the Zod schemas in
`src/data/$TARGET.ts` (at the top of each).

### Syncing with gists

`job-queue` allows you to sync data files with a gist/gists on your GitHub account. This provides 
cloud storage and makes the program more portable.

To link to a gist, provide the gist ID and a GitHub access token in config.json, like:

```json
{
  "$schema": "/job-queue/schemas/config.schema.json",
  "jobqueue": {
    "local": "/job-queue/jobqueue.json",
    "ghGistId": "00000000000000000000000000000000",
    "ghAccessToken": "ghp_000000000000000000000000000000000000"
  },
  "projectpool": {
    "local": "/job-queue/projectpool.json",
    "ghGistId": "00000000000000000000000000000000",
    "ghAccessToken": "ghp_000000000000000000000000000000000000"
  },
  "schemas": "/job-queue/schemas",
}
```

Your gist ID can be copied easily from the URL; usually something like `https://gist.github.com/USERNAME/GIST_ID`.


## Sample Workflow

- _\[Daemon\]_ Spontaneous, not fleshed out ideas get immediately added to the project pool as "inactive".
- You should generally have an idea of a few projects you want to focus on at a time. For each, push
  jobs to the jobqueue that do a **_single thing_** (ideally no more; they should be contained in a
  single Git commit).
- Work (while you haven't finished the projects you're focusing on)
  - Go through job queue and remove jobs when complete (committing as you go).
  - _\[Daemon\]_ While not on the terminal, think of next jobs, then push to queue.
