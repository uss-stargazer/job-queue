import * as z from 'zod';
import { JsonData } from './jsonData.js';
import { Octokit } from '@octokit/rest';
import { simpleDeepCompare } from './index.js';

// Core definitions and methods -------------

export interface GistData<T> extends JsonData<T> {
  isLinked: boolean;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  linkGist: (gist: { id: string; accessToken: string } | null) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isGistData = <T = z.ZodType>(obj: any): obj is GistData<T> =>
  typeof obj === 'object' &&
  obj !== null &&
  'isLinked' in obj &&
  typeof obj.isLinked === 'boolean' &&
  'pull' in obj &&
  typeof obj.pull === 'function' &&
  'push' in obj &&
  typeof obj.push === 'function' &&
  'linkGist' in obj &&
  typeof obj.linkGist === 'function';

export class GistDataError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type KindaGist = Partial<{ contents: string; description: string }>;

const pullGist = async (
  octokit: Octokit,
  filename: string,
  gistId: string,
): Promise<KindaGist> => {
  const resp = await octokit.gists.get({ gist_id: gistId });
  if (resp.status < 200 || resp.status >= 300)
    throw new GistDataError(
      `Could not pull gist for '${filename}': HTTP ${resp.status}`,
    );

  const gistFiles = Object.keys(resp.data.files);
  if (!gistFiles.includes(filename))
    throw new GistDataError(
      `Could not pull gist for '${filename}': '${filename}' not in gist files (${gistFiles.join(', ')})`,
    );
  const gistFile = resp.data.files[filename];

  return {
    contents: gistFile.content,
    description: resp.data.description,
  };
};

const pushGist = async (
  octokit: Octokit,
  filename: string,
  gistId: string,
  gist: KindaGist,
): Promise<void> => {
  if (!gist.description && !gist.contents)
    throw new TypeError(
      `pushGist called with nothing to change (for '${filename}')`,
    );

  await octokit.gists.update({
    gist_id: gistId,
    description: gist.description,
    files: {
      [filename]: {
        content: gist.contents,
      },
    },
  });
};

/**
 * Create GistData object this UNLINKED BY DEFAULT. You must call `linkGist()` to actually
 * link it to a real gist.
 */
export const makeGistData = async <S extends z.ZodType>(
  schema: S,
  jsonData: JsonData<z.infer<S>>,
  filename: string, // Just in case the name is different than the path.basename(jsonPath)
  handleConflict: (ours: z.infer<S>, theirs: z.infer<S>) => Promise<z.infer<S>>,
  handleInvalidGist: (
    gistContents: string,
    error: z.ZodError | SyntaxError,
  ) => Promise<z.infer<S> | null>, // Return null to ignore invalid gist
  overwriteDescription?: string,
): Promise<GistData<z.infer<S>>> => {
  let octokit: Octokit = null;
  let gist: Awaited<ReturnType<typeof pullGist>> = null;
  let lastGistData: z.infer<S> = null;

  const unlinkedPull: GistData<z.infer<S>>['pull'] = async () => {
    throw new Error('Cannot pull unlinked gist');
  };
  const unlinkedPush: GistData<z.infer<S>>['pull'] = async () => {
    throw new Error('Cannot push unlinked gist');
  };

  // Errors might occur here if the types for GistData change, since we're kinda ignoring typescript here
  const gistData = jsonData as GistData<z.infer<S>>;
  gistData.isLinked = false;
  gistData.pull = unlinkedPull;
  gistData.push = unlinkedPush;
  gistData.linkGist = async (newGistParams): Promise<void> => {
    if (!newGistParams && !gistData.isLinked) {
      return;
    } else if (!newGistParams && gistData.isLinked) {
      gistData.pull = unlinkedPull;
      gistData.push = unlinkedPush;
      gistData.isLinked = false;
    } else {
      const { id: gistId, accessToken } = newGistParams;
      octokit = new Octokit({ auth: accessToken });

      gistData.pull = async (): Promise<void> => {
        gist = await pullGist(octokit, filename, gistId);
        if (gist.contents && gist.contents.trim().length > 0) {
          let parsedData: z.infer<S>;
          try {
            parsedData = schema.parse(JSON.parse(gist.contents));
          } catch (error) {
            if (!(error instanceof z.ZodError || error instanceof SyntaxError))
              throw error;
            const newData = await handleInvalidGist(gist.contents, error);
            if (newData !== null) gistData.data = newData;
          }
          lastGistData = parsedData;

          if (!simpleDeepCompare(gistData.data, parsedData))
            gistData.data = await handleConflict(gistData.data, parsedData);

          await gistData.sync();
        }
      };

      gistData.push = async (): Promise<void> => {
        if (!gist)
          console.warn(
            'pushing GistData without pulling first; will overwrite',
          );

        await gistData.sync();
        if (!simpleDeepCompare(lastGistData, gistData.data))
          await pushGist(octokit, filename, gistId, {
            description:
              overwriteDescription &&
              (!gist || gist.description !== overwriteDescription)
                ? overwriteDescription
                : undefined,
            contents: JSON.stringify(
              schema.encode(gistData.data),
              undefined,
              '  ',
            ),
          });
      };

      gistData.isLinked = true;
    }
  };

  return gistData;
};
