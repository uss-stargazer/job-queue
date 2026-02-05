import path from 'path';
import { dataNames, dataSchemas, DataTypes } from '../data/index.js';
import { makeJsonData } from './jsonData.js';
import { readFileSync, writeFileSync } from 'fs';

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
  filepath: path.join(process.cwd(), `sample/${name}.json`),
  defaultData: defaultData[name],
  changedData: changedData[name],
}));

type Target = (typeof dataTargets)[number];

const testTargets = async (
  func: (target: Target) => Promise<void>,
): Promise<void> => {
  for (const target of dataTargets) await func(target);
};

// The actual tests

describe('jsonData', () => {
  it('should load the correct data initially', () =>
    testTargets(async (target) => {
      for (const data of [target.defaultData, target.changedData]) {
        writeFileSync(target.filepath, JSON.stringify(data), {
          encoding: 'utf8',
        });
        const jsonData = await makeJsonData(target.filepath, target.schema);
        expect(jsonData.data).toStrictEqual(data);
      }
    }));
  it('should throw on invalid data initially', () =>
    testTargets(async (target) => {
      writeFileSync(target.filepath, JSON.stringify('some invalid data'), {
        encoding: 'utf8',
      });
      await expect(() =>
        makeJsonData(target.filepath, target.schema),
      ).rejects.toThrow();
    }));
  describe('sync', () => {
    it('should write the same contents as data', () =>
      testTargets(async (target) => {
        writeFileSync(target.filepath, JSON.stringify(target.defaultData));
        const jsonData = await makeJsonData(target.filepath, target.schema);

        for (const data of [target.defaultData, target.changedData]) {
          jsonData.data = data;
          await jsonData.sync();
          expect(
            JSON.parse(readFileSync(target.filepath, { encoding: 'utf8' })),
          ).toStrictEqual(data);
        }
      }));
  });
});
