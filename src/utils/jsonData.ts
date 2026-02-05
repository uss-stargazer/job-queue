import fs from 'fs/promises';
import * as z from 'zod';

export type JsonData<T> = {
  data: T;
  sync: () => Promise<void>;
};

export const makeJsonData = async <S extends z.ZodType>(
  jsonPath: string,
  schema: S,

  // If z.input is not equal to z.output, we need a conversion function
  ...[toInput]: (<T>() => T extends z.input<S> ? 1 : 2) extends <
    T,
  >() => T extends z.output<S> ? 1 : 2
    ? []
    : [toInput: (decoded: z.output<S>) => z.input<S>]
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
      `JSON at '${jsonPath}' does not match schema: ${z.prettifyError(parsed.error)}`,
    );

  const jsonData: JsonData<z.infer<S>> = {
    data: parsed.data,
    sync() {
      const encoded = toInput ? toInput(jsonData.data) : jsonData.data;
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
