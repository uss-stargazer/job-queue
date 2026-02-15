import * as z from 'zod';
import * as tmp from 'tmp-promise';
import chalk from 'chalk';
import { confirm, select } from '@inquirer/prompts';
import { editInteractively } from 'edit-like-git';
import fs from 'fs/promises';
import { AbortError, clearNLines, IsAsymmetricZod } from './index.js';
import { JsonData, makeJsonData } from './jsonData.js';
import { existsSync } from 'fs';
import path from 'path';
import { makeGistData } from './gistData.js';
import { diffLines } from 'diff';

type CheckFunction<T> = (
  input: T,
) => 'pass' | 'continue' | { errMessage: string };
type HaveUserUpdateOptions = Partial<{
  editor: string;
  errorHead: string;
  file: { type: 'tmp'; prefix?: string } | { type: 'abs'; path: string };
  tooltips: string[];
  jsonSchemaUrl: string;
}>;

export const haveUserUpdateContents = async (
  contents: string,
  options?: HaveUserUpdateOptions,
  check?: CheckFunction<string>,
): Promise<string | undefined> => {
  const file: { path: string; cleanup?: () => Promise<void> } =
    options?.file?.type && options.file.type === 'abs'
      ? { path: options.file.path }
      : await tmp.file({
          prefix:
            options?.file?.type === 'tmp' ? options.file.prefix : undefined,
          postfix: '.json',
        });

  const originalContents = await fs.readFile(file.path, { encoding: 'utf8' });

  while (true) {
    contents = await editInteractively(
      file.path,
      contents,
      options?.editor,
      options?.tooltips,
    );

    if (check) {
      const error = check(contents);
      if (error === 'pass') {
        break;
      } else if (typeof error === 'object') {
        console.log(chalk.red(`${options?.errorHead}:`), error.errMessage);

        if (!(await inquirerConfirm('Try again?'))) {
          if (file.cleanup) await file.cleanup();
          else
            await fs.writeFile(file.path, originalContents, {
              encoding: 'utf8',
            });

          throw new AbortError('User aborted action');
        }
      }
    }
  }

  if (file.cleanup) await file.cleanup();
  return contents;
};

export const haveUserUpdateData = async <
  S extends z.ZodType,
  D extends 'in' | 'out' = 'out',
>(
  schema: S,
  data: D extends 'in' ? z.input<S> : z.output<S>,
  options?: HaveUserUpdateOptions,
  checks?: Partial<{
    preparse: CheckFunction<string>;
    postparse: CheckFunction<z.infer<S>>;
  }>,
): Promise<z.infer<S> | undefined> => {
  const contents: string | void = JSON.stringify(
    schema instanceof z.ZodObject && options?.jsonSchemaUrl
      ? { $schema: options?.jsonSchemaUrl, ...(data as object) }
      : data,
    undefined,
    '  ',
  );

  let updatedData: z.infer<S> | undefined = undefined;

  await haveUserUpdateContents(contents, options, (contents) => {
    // Load back editor contents and validate them

    if (checks?.preparse) {
      const preparseError = checks.preparse(contents);
      if (preparseError !== 'continue') {
        updatedData = undefined;
        return preparseError;
      }
    }

    try {
      updatedData = schema.parse(JSON.parse(contents));

      if (checks?.postparse) {
        const postparseError = checks.postparse(updatedData);
        if (typeof postparseError === 'object') return postparseError;
      }
      return 'pass';
    } catch (error) {
      if (error instanceof SyntaxError)
        return { errMessage: `Recieved invalid JSON: ${error.message}` };
      else if (error instanceof z.ZodError)
        return {
          errMessage: `JSON does not match schema:\n${z.prettifyError(error)}`,
        };
      else throw error;
    }
  });

  return updatedData;
};

/**
 * Tries to get data following a Zod `schema` from the `expectedPath` while being nice to the user.
 * Otherwise, call `recreateData` and write JSON to `expectedPath` and then try to parse the file
 * again into JsonData.
 */
export async function getDataTargetNicely<S extends z.ZodType>(
  schema: S,
  target: {
    name: string;
    expectedPath: string;
    jsonSchemaUrl?: string;
  },
  recreateData: () => Promise<{
    encoded: z.input<S>;
    newJsonPath?: string;
    newJsonSchemaUrl?: string;
  }>,
  autoCreateFiles: boolean = false,
  ...conversionArg: IsAsymmetricZod<S> extends true
    ? [toInput: (decoded: z.output<S>) => z.input<S>]
    : []
): Promise<{ data: JsonData<z.infer<S>>; hadToCreate: boolean }> {
  let jsonData: JsonData<z.infer<S>> | undefined = undefined;
  let hadToCreate: boolean = false;

  try {
    if (!existsSync(target.expectedPath))
      throw new AbortError( // Hacky hack; just using AbortError so I can check for it during catch
        `File '${target.expectedPath}' for ${target.name} does not exist`,
      );

    jsonData = await makeJsonData(
      target.expectedPath,
      schema,
      target.jsonSchemaUrl,
      ...conversionArg,
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.log(chalk.red('[e]'), `Invalid JSON at '${target.expectedPath}'`);
    } else if (error instanceof z.ZodError) {
      console.log(
        chalk.red('[e]'),
        `JSON at '${target.expectedPath}' does not match schema:\n${z.prettifyError(error)}`,
      );
    } else if (error instanceof AbortError) {
      console.log(chalk.red('[e]'), error.message);
    } else throw error;

    const shouldRegenerate =
      autoCreateFiles ||
      (await confirm({
        message: `Want to regenerate ${target.name}?`,
      }).finally(() => clearNLines(1)));

    if (shouldRegenerate) {
      clearNLines(1); // Clear error line
      console.log(
        chalk.blue('[i]'),
        `Creating ${target.name} at '${target.expectedPath}'...`,
      );
      hadToCreate = true;

      const { encoded, newJsonPath, newJsonSchemaUrl } = await recreateData();
      if (newJsonPath) target.expectedPath = newJsonPath;
      if (newJsonSchemaUrl) target.jsonSchemaUrl = newJsonSchemaUrl;

      const dir = path.dirname(target.expectedPath);
      if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        target.expectedPath,
        JSON.stringify(
          typeof encoded === 'object' && target.jsonSchemaUrl
            ? { $schema: target.jsonSchemaUrl, ...encoded }
            : encoded,
          undefined,
          '  ',
        ),
      );

      jsonData = await makeJsonData(
        newJsonPath ?? target.expectedPath,
        schema,
        target.jsonSchemaUrl,
        ...conversionArg,
      );
    } else throw error;
  }

  if (!jsonData) throw new Error(`Could not get data target ${target.name}`);

  return { data: jsonData, hadToCreate };
}

export const inquirerConfirm = (message: string): Promise<boolean> =>
  confirm({ message }).finally(() => clearNLines(1));

const formatGitChange = (
  ours: string,
  theirs: string,
  removeExtraLine: boolean = false, // Hacky hack: annoying extra line with usage in resolveConflictLikeGit
): string =>
  `<<<<<<< ours
${ours}${removeExtraLine ? '' : '\n'}=======
${theirs}${removeExtraLine ? '' : '\n'}>>>>>>> theirs
`;

export const resolveConflictLikeGit = async <S extends z.ZodType>(
  schema: S,
  ours: z.infer<S>,
  theirs: z.infer<S>,
  editor?: string,
): Promise<z.infer<S>> => {
  const objStrings = [ours, theirs].map((o) =>
    JSON.stringify(o, undefined, '  '),
  ) as [string, string];
  const diff = diffLines(...objStrings);

  let changeGroup: [ours: string, theirs: string] | null = null;
  const diffLikeGit = diff.reduce((diffString, change, idx) => {
    if (!change.added && !change.removed) {
      if (changeGroup) {
        diffString += formatGitChange(...changeGroup, true);
        changeGroup = null;
      }
      diffString += change.value;
    } else {
      if (!changeGroup) changeGroup = ['', ''];
      changeGroup[change.added ? 1 : 0] += change.value;
    }

    // Write change group if its the end
    if (changeGroup && idx === diff.length - 1)
      diffString += formatGitChange(...changeGroup, true);

    return diffString;
  }, '');

  let resolved: z.infer<S> | undefined = undefined;
  await haveUserUpdateContents(
    diffLikeGit,
    {
      editor,
      errorHead: 'Resolve conflict failed',
      file: { type: 'tmp', prefix: 'gist-confict' },
      tooltips: ['Resolve the conflict.'],
    },
    (contents) => {
      try {
        resolved = schema.parse(JSON.parse(contents));
        return 'pass';
      } catch (error) {
        if (error instanceof SyntaxError)
          return { errMessage: `Recieved invalid JSON: ${error.message}` };
        else if (error instanceof z.ZodError)
          return {
            errMessage: `JSON does not match schema:\n${z.prettifyError(error)}`,
          };
        else throw error;
      }
    },
  );

  return resolved;
};

// GistData functions for easier use --------------

type MakeGistParams<T extends z.ZodType> = Parameters<typeof makeGistData<T>>;

export const makeGistConflictHandler =
  <S extends z.ZodType>(schema: S, editor?: string): MakeGistParams<S>[3] =>
  async (ours, theirs) => {
    console.log(
      chalk.yellow('[w]'),
      `Pulled gist is different than local JSON`,
    );
    const oursOrTheirs = await select({
      message: 'Want to use ours or theirs?',
      choices: [
        { value: 'ours', description: '(local JSON)' },
        { value: 'theirs', description: '(the gist)' },
        { value: 'resolve', description: 'resolve manually' },
      ] as const,
    });

    return oursOrTheirs === 'theirs'
      ? theirs
      : oursOrTheirs === 'ours'
        ? ours
        : await resolveConflictLikeGit(schema, ours, theirs, editor);
  };

export const handleInvalidGist: MakeGistParams<z.ZodAny>[4] = async (
  _,
  error,
) => {
  let filename;
  console.log(
    chalk.red('[e]'),
    `Pulled gist for '${filename}' is invalid: doesn't match schema:\n${error instanceof z.ZodError ? z.prettifyError(error) : error.message}"`,
  );
  const shouldContinue = await confirm({
    message: 'Ignore gist contents and continue?',
  });
  if (!shouldContinue)
    throw new Error(`Invalid gist for '${filename}' and user aborted`);
};
