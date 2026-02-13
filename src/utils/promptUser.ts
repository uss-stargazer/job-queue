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

type CheckFunction<T> = (
  input: T,
) => 'pass' | 'continue' | { errMessage: string };

export const haveUserUpdateData = async <
  S extends z.ZodType,
  D extends 'in' | 'out' = 'out',
>(
  schema: S,
  data: D extends 'in' ? z.input<S> : z.output<S>,
  options?: Partial<{
    editor: string;
    errorHead: string;
    file: { type: 'tmp'; prefix?: string } | { type: 'abs'; path: string };
    tooltips: string[];
    jsonSchemaUrl: string;
  }>,
  checks?: Partial<{
    preparse: CheckFunction<string>;
    postparse: CheckFunction<z.infer<S>>;
  }>,
): Promise<z.infer<S> | undefined> => {
  const file: { path: string; cleanup?: () => Promise<void> } =
    options?.file?.type && options.file.type === 'abs'
      ? { path: options.file.path }
      : await tmp.file({
          prefix:
            options?.file?.type === 'tmp' ? options.file.prefix : undefined,
          postfix: '.json',
        });

  const originalContents = await fs.readFile(file.path, { encoding: 'utf8' });
  let contents: string | void = JSON.stringify(
    schema instanceof z.ZodObject && options?.jsonSchemaUrl
      ? { $schema: options?.jsonSchemaUrl, ...(data as object) }
      : data,
    undefined,
    '  ',
  );

  let updatedData: z.infer<S> | undefined = undefined;

  while (true) {
    // Open temp file in editor while also allowing user to abort

    const controller = new AbortController();
    const signal = controller.signal;
    const editorPromise = editInteractively(
      file.path,
      contents,
      options?.editor,
      options?.tooltips,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Hacky hack to print abort after edit tooltips
    const abortPromise = confirm(
      { message: 'Type `y` to abort...' },
      { signal },
    )
      .finally(() => clearNLines(1)) // Remove prompt line
      .then(async (shouldAbort) => {
        if (shouldAbort) {
          if (file.cleanup) await file.cleanup();
          else
            await fs.writeFile(file.path, originalContents, {
              encoding: 'utf8',
            });

          throw new AbortError('User aborted action');
        }
      });
    contents = await Promise.race([editorPromise, abortPromise]);
    controller.abort();
    if (typeof contents !== 'string') return undefined;

    // Load back editor contents and validate them

    if (checks?.preparse) {
      const preparseError = checks?.preparse(contents);
      if (preparseError === 'pass') {
        updatedData = undefined;
        break;
      } else if (typeof preparseError === 'object') {
        console.log(
          chalk.red(`${options?.errorHead}:`),
          preparseError.errMessage,
        );
        continue;
      }
    }

    try {
      updatedData = schema.parse(JSON.parse(contents));

      if (checks?.postparse) {
        const postparseError = checks?.postparse(updatedData);
        if (typeof postparseError === 'object') {
          console.log(
            chalk.red(`${options?.errorHead}:`),
            postparseError.errMessage,
          );
          continue;
        }
      }
      break;
    } catch (error) {
      if (error instanceof SyntaxError)
        console.log(
          chalk.red(`${options?.errorHead}:`),
          `Recieved invalid JSON: ${error.message}`,
        );
      else if (error instanceof z.ZodError)
        console.log(
          chalk.red(`${options?.errorHead}:`),
          `JSON does not match schema:\n${z.prettifyError(error)}`,
        );
      else throw error;
    }
  }

  if (file.cleanup) await file.cleanup();
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

// GistData functions for easier use --------------

type MakeGistParams<T extends z.ZodType> = Parameters<typeof makeGistData<T>>;

export const handleGistConflict: MakeGistParams<z.ZodAny>[3] = async (
  ours,
  theirs,
) => {
  console.log(chalk.yellow('[w]'), `Pulled gist is different than local JSON`);
  const oursOrTheirs = await select({
    message: 'Want to use ours or theirs?',
    choices: [
      { value: 'ours', description: '(local JSON)' },
      { value: 'theirs', description: '(the gist)' },
    ] as const,
  });
  return oursOrTheirs === 'theirs' ? theirs : ours;
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
