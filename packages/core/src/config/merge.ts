/**
 * Deep-merges a series of plain objects left-to-right.
 * Later sources win on scalar conflicts; objects are merged recursively.
 * Arrays are replaced (not concatenated) — intentional: config arrays
 * like `serverList` should be fully overridden, not appended to.
 *
 * @module config/merge
 */

type PlainObject = Record<string, unknown>;

/**
 * Returns true if the value is a non-null, non-array plain object.
 */
function isPlainObject(value: unknown): value is PlainObject {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Deep-merges two plain objects. `source` values win over `target` values
 * for scalar fields. Object fields are recursively merged.
 */
function mergeTwo(target: PlainObject, source: PlainObject): PlainObject {
  const result: PlainObject = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];

    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      result[key] = mergeTwo(tgtVal, srcVal);
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }

  return result;
}

/**
 * Deep-merges N plain objects left-to-right.
 * The last argument has the highest priority (wins all conflicts).
 *
 * @example
 * ```ts
 * const merged = deepMerge(defaults, fileConfig, envOverrides);
 * ```
 */
export function deepMerge(...sources: Partial<PlainObject>[]): PlainObject {
  return sources.reduce<PlainObject>(
    (acc, src) => (src !== undefined ? mergeTwo(acc, src as PlainObject) : acc),
    {},
  );
}
