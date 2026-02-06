import fs from 'fs/promises';
import * as z from 'zod';

export type JsonData<T> = {
  data: T;
  sync: () => Promise<void>;
};

/**
 * @throws SyntaxError (file doesn't contain JSON), ZodError (couldn't parse), Error (generic; e.g. couldn't open file)
 */
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

  const data = schema.parse(json);
  const jsonData: JsonData<z.infer<S>> = {
    data,
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
