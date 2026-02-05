import { JobQueueSchema } from './jobqueue.js';
import { ProjectPoolSchema } from './projectpool.js';
import { ConfigSchema } from './config.js';
import * as z from 'zod';
import { JsonData } from '../utils/jsonData.js';

export const dataNames = ['jobqueue', 'projectpool', 'config'] as const;
export type DataName = (typeof dataNames)[number];
export const dataSchemas = {
  jobqueue: JobQueueSchema,
  projectpool: ProjectPoolSchema,
  config: ConfigSchema,
} as const satisfies { [N in DataName]: z.ZodType };
export type DataTypes = { [N in DataName]: z.infer<(typeof dataSchemas)[N]> };
export type DataInJsonDatas = { [N in DataName]: JsonData<DataTypes[N]> };
