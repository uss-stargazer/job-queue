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
