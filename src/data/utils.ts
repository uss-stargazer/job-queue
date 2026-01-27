import * as tmp from 'tmp-promise';
import fs from 'fs/promises';
import chalk from 'chalk';
import * as z from 'zod';
import { confirm } from '@inquirer/prompts';
import { AbortError } from '../utils/index.js';
import { editInteractively } from 'edit-like-git';

export type JsonData<T> = {
  data: T;
  schema?: string;
  sync: () => Promise<void>;
};

export const makeJsonData = async <S extends z.ZodType>(
  jsonPath: string,
  schema: S,
): Promise<JsonData<z.infer<S>>> => {
  let json;
  try {
    json = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  } catch (error) {
    throw new Error(`Couldn't open '${jsonPath}': ${error}`);
  }
  const schemaUrl = json['$schema'];
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new Error(
      `JSON at '${jsonPath}' does not match schema: ${parsed.error.message}`,
    );
  return {
    data: parsed.data,
    schema: typeof schemaUrl === 'string' ? schemaUrl : undefined,
    sync: async (): Promise<void> => {
      const encoded = schema.encode(parsed.data);
      return fs.writeFile(
        jsonPath,
        JSON.stringify(
          typeof schemaUrl === 'string'
            ? {
                $schema: schemaUrl,
                ...(encoded as object) /* Must be object if schemaUrl is defined */,
              }
            : encoded,
          undefined,
          '  ',
        ),
        'utf8',
      );
    },
  };
};

type CheckFunction<T> = (
  input: T,
) => 'pass' | 'continue' | { errMessage: string };

export const haveUserUpdateData = async <S extends z.ZodType>(
  schema: S,
  data: z.infer<S>,
  options: Partial<{
    editor: string;
    errorHead: string;
    tmpPrefix: string;
    tooltips: string[];
  }>,
  checks: Partial<{
    preparse: CheckFunction<string>;
    postparse: CheckFunction<z.infer<S>>;
  }>,
): Promise<z.infer<S> | undefined> => {
  const tmpFile = await tmp.file({
    prefix: options.tmpPrefix,
    postfix: '.json',
  });
  const initialContents = JSON.stringify(schema.encode(data), undefined, '  ');

  let updatedResult: ReturnType<typeof schema.safeParse> | undefined =
    undefined;

  while (true) {
    // Open temp file in editor while also allowing user to abort

    const controller = new AbortController();
    const signal = controller.signal;
    const editorPromise = editInteractively(
      tmpFile.path,
      initialContents,
      options.editor,
      options.tooltips,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Hacky hack to print abort after edit tooltips
    const abortPromise = confirm(
      { message: 'Type `y` to abort...' },
      { signal },
    )
      .finally(() => {
        // Remove prompt line
        process.stdout.moveCursor(0, -1);
        process.stdout.clearLine(1);
      })
      .then(async (shouldAbort) => {
        if (shouldAbort) {
          await tmpFile.cleanup();
          throw new AbortError('User aborted action');
        }
      });
    const updatedJsonString = await Promise.race([editorPromise, abortPromise]);
    controller.abort();
    if (typeof updatedJsonString !== 'string') return undefined;

    // Load back editor contents and validate them

    if (checks.preparse) {
      const preparseError = checks.preparse(updatedJsonString);
      if (preparseError === 'pass') {
        updatedResult = undefined;
        break;
      } else if (typeof preparseError === 'object') {
        console.log(
          chalk.red(`${options.errorHead}:`),
          preparseError.errMessage,
        );
        continue;
      }
    }

    updatedResult = schema.safeParse(JSON.parse(updatedJsonString));

    if (updatedResult.success) {
      if (checks.postparse) {
        const postparseError = checks.postparse(updatedResult.data);
        if (typeof postparseError === 'object') {
          console.log(
            chalk.red(`${options.errorHead}:`),
            postparseError.errMessage,
          );
          continue;
        }
      }

      break;
    }
    console.log(
      chalk.red(`${options.errorHead}:`),
      `JSON invalid: ${updatedResult.error.message}`,
    );
  }
  await tmpFile.cleanup();

  return (
    updatedResult &&
    (updatedResult.success
      ? updatedResult.data
      : ((): never => {
          throw new Error(
            `${options.errorHead}: JSON invalid: ${updatedResult.error.message}`,
          );
        })())
  );
};
