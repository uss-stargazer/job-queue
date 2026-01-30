import fs from 'fs/promises';
import * as z from 'zod';

export type JsonData<T> = {
  data: T;
  sync: () => Promise<void>;
};

export const makeJsonData = async <S extends z.ZodType>(
  jsonPath: string,
  schema: S,
): Promise<JsonData<z.infer<S>>> => {
  const json = JSON.parse(
    await fs.readFile(jsonPath, 'utf8').catch((error) => {
      throw new Error(`Couldn't open '${jsonPath}': ${error}`);
    }),
  );

  const schemaUrl = json['$schema']; // save $schema (if it exists) for writing on sync()
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new Error(
      `JSON at '${jsonPath}' does not match schema: ${z.treeifyError(parsed.error)}`,
    );

  const jsonData: JsonData<z.infer<S>> = {
    data: parsed.data,
    async sync() {
      const encoded = schema.encode(jsonData.data);
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

  return jsonData;
};
