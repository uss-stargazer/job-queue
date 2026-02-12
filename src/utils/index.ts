import * as z from 'zod';

export type IsAsymmetricZod<S extends z.ZodType> =
  (<G>() => G extends z.input<S> ? 1 : 2) extends <G>() => G extends z.output<S>
    ? 1
    : 2
    ? false
    : true;

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

export const clearNLines = (n: number): void => {
  for (let i = 0; i < n; i++) {
    process.stdout.moveCursor(0, -1);
    process.stdout.clearLine(1);
  }
  process.stdout.cursorTo(0);
};

/**
 * For noncomplex deep compare, simply stringifies the two values and compares the strings.
 */
export const simpleDeepCompare = (
  /* eslint-disable @typescript-eslint/no-explicit-any */
  a: any,
  b: any,
  replacer?: (key: string, value: any) => any,
  /* eslint-enable @typescript-eslint/no-explicit-any */
): boolean => JSON.stringify(a, replacer) === JSON.stringify(b, replacer);
