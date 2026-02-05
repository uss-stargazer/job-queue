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
