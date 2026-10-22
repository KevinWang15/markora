import type { ComponentProps } from "./types";

export const MAX_COMPONENT_SOURCE_LENGTH = 65_536;
export const componentNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

type Budget = { remaining: number };

function consume(budget: Budget, length: number) {
  budget.remaining -= length;
  if (budget.remaining < 0) throw new TypeError(`Component properties exceed ${MAX_COMPONENT_SOURCE_LENGTH} characters.`);
}

function consumeString(budget: Budget, value: string) {
  if (value.length > budget.remaining) consume(budget, value.length);
  consume(budget, JSON.stringify(value).length);
}

function isPlainObject(value: object) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || prototype === Object.prototype) return true;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  return Object.getPrototypeOf(prototype) === null && typeof constructor === "function"
    && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object);
}

function cloneJson(value: unknown, ancestors: Set<object>, depth: number, budget: Budget): unknown {
  if (depth > 32) throw new TypeError("Component properties exceed the maximum nesting depth (32).");
  if (typeof value === "string") {
    consumeString(budget, value);
    return value;
  }
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    consume(budget, JSON.stringify(value).length);
    return value;
  }
  if (typeof value !== "object" || value === null || ancestors.has(value)) {
    throw new TypeError("Component properties must contain only finite, acyclic JSON values.");
  }
  const array = Array.isArray(value);
  if (!array && !isPlainObject(value)) {
    throw new TypeError("Component properties must be plain JSON objects.");
  }
  ancestors.add(value);
  consume(budget, 2);
  if (array && value.length > budget.remaining) consume(budget, value.length);
  const keys = Reflect.ownKeys(value);
  if (keys.length - Number(array) > budget.remaining) consume(budget, keys.length - Number(array));
  const result: Record<string, unknown> | unknown[] = array ? [] : {};
  let count = 0;
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("Component properties cannot contain symbols, accessors, or hidden properties.");
    }
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
      throw new TypeError("Component arrays cannot have named properties.");
    }
    consume(budget, (count === 0 ? 1 : 2) + 2 * (depth + 1));
    if (!array) {
      consumeString(budget, key);
      consume(budget, 2);
    }
    Object.defineProperty(result, key, {
      enumerable: true,
      value: cloneJson(descriptor.value, ancestors, depth + 1, budget),
    });
    count++;
  }
  if (array && count !== value.length) {
    throw new TypeError("Component arrays cannot contain holes.");
  }
  if (count > 0) consume(budget, 1 + 2 * depth);
  ancestors.delete(value);
  return Object.freeze(result);
}

export function snapshotProps(value: unknown): ComponentProps {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Component properties must be a JSON object.");
  }
  return cloneJson(value, new Set(), 0, { remaining: MAX_COMPONENT_SOURCE_LENGTH }) as ComponentProps;
}

export function parseSource(source: string): ComponentProps {
  if (source.length > MAX_COMPONENT_SOURCE_LENGTH) {
    throw new TypeError(`Component source exceeds ${MAX_COMPONENT_SOURCE_LENGTH} characters.`);
  }
  return snapshotProps(JSON.parse(source));
}

export function componentMarkdown(name: string, source: string) {
  const runs = source.match(/`+/g) ?? [];
  const fence = "`".repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
  return `${fence}component:${name}\n${source}\n${fence}`;
}
