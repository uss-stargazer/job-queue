import * as z from 'zod';
import path from 'path';
import { dataNames, dataSchemas, DataTypes } from '../data/index.js';
import { GistData, makeGistData } from './gistData.js';
import { readFileSync } from 'fs';
import { Octokit } from '@octokit/rest';
import dns from 'dns/promises';
import { makeJsonData } from './jsonData.js';

dns.resolve('github.com').catch((error) => {
  throw new Error(`Connection to github.com required for test suite: ${error}`);
});

const { TEST_GIST_ID, TEST_GIST_TOKEN } = process.env;
if (!TEST_GIST_ID || !TEST_GIST_TOKEN)
  throw new Error('Need gist env vars to run test suite');

// Test gists

const testGist = { id: TEST_GIST_ID, accessToken: TEST_GIST_TOKEN };
const testOctokit = new Octokit({ auth: testGist.accessToken });
const invalidGist = {
  id: 'this is not a valid gist id',
  accessToken: 'this is not a valid access token',
};

// Test data targets

const targetNames = dataNames.filter((name) => name !== 'config');
type TargetName = (typeof targetNames)[number];
const defaultData: { [K in TargetName]: DataTypes[K] } = {
  jobqueue: { queue: [] },
  projectpool: { pool: [] },
};
const changedData: { [K in TargetName]: DataTypes[K] } = {
  jobqueue: {
    queue: [{ name: 'test', objectivies: ['test'], project: 'test' }],
  },
  projectpool: {
    pool: [{ name: 'test', status: 'inactive' }],
  },
};
const dataTargets = targetNames.map((name) => ({
  schema: dataSchemas[name],
  filename: `${name}.json`,
  filepath: path.join(process.cwd(), `sample/${name}.json`),
  defaultData: defaultData[name],
  changedData: changedData[name],
}));

type Target = (typeof dataTargets)[number];
type TargetSchema = Target['schema'];
type MakeGistDataParams = Parameters<typeof makeGistData<TargetSchema>>;

const testTargets = async (
  func: (
    gistData: GistData<z.infer<TargetSchema>>,
    target: Target,
  ) => Promise<void>,
  handleConflict: MakeGistDataParams[3] = async (_, theirs) => theirs,
  handleInvalidGist: MakeGistDataParams[4] = async () => undefined,
): Promise<void> => {
  for (const target of dataTargets) {
    const jsonData = await makeJsonData(target.filepath, target.schema);
    const gistData = await makeGistData(
      target.schema,
      jsonData,
      target.filename,
      handleConflict,
      handleInvalidGist,
    );
    await func(gistData, target);
  }
};

// The actual tests

describe('gistData', () => {
  describe('linkGist', () => {
    it('should initialize isLinked to false', () =>
      testTargets(async (gistData) => {
        expect(gistData.isLinked).toBe(false);
      }));

    it('should set isLinked to after linking then unlinking', () =>
      testTargets(async (gistData) => {
        await gistData.linkGist(testGist);
        await gistData.linkGist(null);
        expect(gistData.isLinked).toBe(false);
      }));

    it('should not pull when initially linked', () =>
      testTargets(async (gistData, target) => {
        await testOctokit.gists.update({
          gist_id: testGist.id,
          files: {
            [target.filename]: { content: JSON.stringify(target.changedData) },
          },
        });

        gistData.data = target.defaultData;
        await gistData.linkGist(testGist);
        expect(gistData.data).toStrictEqual(target.defaultData);
      }));
  });

  describe('pull', () => {
    it('should throw when initially unlinked', () =>
      testTargets(async (gistData) => {
        await expect(gistData.pull).rejects.toThrow();
      }));

    it('should throw when linked then unlinked', () =>
      testTargets(async (gistData) => {
        await gistData.linkGist(testGist);
        await gistData.linkGist(null);
        await expect(gistData.pull).rejects.toThrow();
      }));

    it('should throw on invalid gist params', () =>
      testTargets(async (gistData) => {
        await gistData.linkGist(invalidGist);
        await expect(gistData.pull).rejects.toThrow();
      }));

    it(
      'should pull and parse the correct data',
      () =>
        testTargets(async (gistData, target) => {
          await gistData.linkGist(testGist);

          for (const data of [target.defaultData, target.changedData]) {
            await testOctokit.gists.update({
              gist_id: testGist.id,
              files: {
                [target.filename]: {
                  content: JSON.stringify(data),
                },
              },
            });

            await gistData.pull();
            expect(gistData.data).toStrictEqual(data);
          }
        }),
      10000,
    );

    it(
      'should recognize invalid pulled data',
      () =>
        testTargets(
          async (gistData, target) => {
            await testOctokit.gists.update({
              gist_id: testGist.id,
              files: {
                [target.filename]: {
                  content: 'some invalid contents',
                },
              },
            });

            gistData.data = target.defaultData;
            await gistData.linkGist(testGist);
            await expect(gistData.pull).rejects.toThrow('INVALID CONTENTS');
          },
          undefined,
          async () => {
            throw new Error('INVALID CONTENTS');
          },
        ),
      10000,
    );

    it('should recognize conflict when pulling', () =>
      testTargets(
        async (gistData, target) => {
          await testOctokit.gists.update({
            gist_id: testGist.id,
            files: {
              [target.filename]: {
                content: JSON.stringify(target.changedData),
              },
            },
          });

          gistData.data = target.defaultData;
          await gistData.linkGist(testGist);
          await expect(gistData.pull).rejects.toThrow('PULL CONFLICT');
        },
        async () => {
          throw new Error('PULL CONFLICT');
        },
      ));
  });

  describe('push', () => {
    it('should throw when initially unlinked', () =>
      testTargets(async (gistData) => {
        await expect(gistData.push).rejects.toThrow();
      }));

    it('should throw when linked then unlinked', () =>
      testTargets(async (gistData) => {
        await gistData.linkGist(testGist);
        await gistData.linkGist(null);
        await expect(gistData.push).rejects.toThrow();
      }));

    it('should throw on invalid gist params', () =>
      testTargets(async (gistData) => {
        await gistData.linkGist(invalidGist);
        await expect(gistData.push).rejects.toThrow();
      }));

    it('should throw when pushing invalid data', () =>
      testTargets(async (gistData) => {
        gistData.data = null;
        await expect(gistData.push).rejects.toThrow();
      }));

    it('should push the same data stored locally', () =>
      testTargets(async (gistData, target) => {
        await gistData.linkGist(testGist);
        gistData.data = target.defaultData;
        await gistData.sync();
        await gistData.push();

        const gistContent = (
          await testOctokit.gists.get({
            gist_id: testGist.id,
          })
        ).data.files[target.filename].content;

        const json = JSON.parse(
          readFileSync(target.filepath, { encoding: 'utf8' }),
        );
        delete json.$schema;
        expect(JSON.parse(gistContent)).toStrictEqual(json);
      }));

    it('should sync with local file before pushing', () =>
      testTargets(async (gistData, target) => {
        await gistData.linkGist(testGist);
        gistData.data = target.defaultData;
        await gistData.sync();
        gistData.data = target.changedData;
        await gistData.push();

        expect(
          target.schema.parse(
            JSON.parse(readFileSync(target.filepath, { encoding: 'utf8' })),
          ),
        ).toStrictEqual(target.changedData);
      }));

    it(
      "should check if data's changed before pushing",
      () =>
        testTargets(async (gistData, target) => {
          await testOctokit.gists.update({
            gist_id: testGist.id,
            files: {
              [target.filename]: {
                content: JSON.stringify(target.defaultData, undefined, '  '),
              },
            },
          });

          await gistData.linkGist(testGist);
          await gistData.pull();
          await new Promise((resolve) => setTimeout(resolve, 2000));

          gistData.data = target.defaultData;
          const pushDate = new Date();
          await gistData.push();

          expect(
            new Date(
              (await testOctokit.gists.get({ gist_id: testGist.id })).data
                .updated_at,
            ) < pushDate,
          ).toBe(true);
        }),
      5000 + 2000 * targetNames.length,
    );
  });
});
