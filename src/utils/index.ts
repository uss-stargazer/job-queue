import * as tmp from 'tmp-promise';
import chalk from 'chalk';
import * as z from 'zod';
import { confirm } from '@inquirer/prompts';
import { editInteractively } from 'edit-like-git';
import fs from 'fs/promises';

export class AbortError extends Error {
  constructor(message) {
    super(message);
  }
}

/** Reorders in place */
export function reorder<T>(array: T[], newIndecies: number[]): void {
  if (array.length !== newIndecies.length)
    throw new RangeError('Indecies array must be same length as target array');

  const originalArray = [...array];
  newIndecies.forEach((originalIdx, idx) => {
    array[idx] = originalArray[originalIdx];
  });
}

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
      .finally(() => {
        // Remove prompt line
        process.stdout.moveCursor(0, -1);
        process.stdout.clearLine(1);
      })
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
