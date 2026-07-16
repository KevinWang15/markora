/** Create a runtime-immutable ReadonlySet facade without mutation methods. */
export function createReadonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
  const source = new Set(values);
  let readonlySet!: ReadonlySet<T>;

  readonlySet = Object.freeze({
    get size() {
      return source.size;
    },
    entries: source.entries.bind(source),
    forEach(
      callback: (value: T, valueAgain: T, set: ReadonlySet<T>) => void,
      thisArg?: unknown,
    ) {
      source.forEach((value) => callback.call(thisArg, value, value, readonlySet));
    },
    has: source.has.bind(source),
    keys: source.keys.bind(source),
    values: source.values.bind(source),
    [Symbol.iterator]: source[Symbol.iterator].bind(source),
  });

  return readonlySet;
}
