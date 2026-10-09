/**
 * Copy of `value` with every `undefined` entry dropped, so a spread cannot
 * blank a base field with an explicit `undefined`.
 *
 * @param value - The object to copy.
 * @returns A shallow copy without its `undefined` entries. `0`, `false`, `''` and
 * `null` are kept; nested objects are not walked.
 * @example
 * withoutUndefined({ padding: 0, layout: undefined }); // { padding: 0 }
 */
export function withoutUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as Partial<T>;
}
