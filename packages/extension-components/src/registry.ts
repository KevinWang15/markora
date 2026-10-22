import { componentNamePattern, snapshotProps } from "./props";
import type {
  AnyComponentDefinition, ComponentDefinition, ComponentOptions, ComponentProps, ComponentRegistry,
} from "./types";

type InternalDefinition = ComponentOptions<object>;
type RegistryState = {
  definitions: Map<string, AnyComponentDefinition>;
  listeners: Set<(name: string) => void>;
};

const definitions = new WeakMap<AnyComponentDefinition, InternalDefinition>();
const registries = new WeakMap<ComponentRegistry, RegistryState>();

export function defineComponent<TProps extends object>(options: ComponentOptions<TProps>): ComponentDefinition<TProps> {
  if (!options || typeof options.name !== "string" || !componentNamePattern.test(options.name) || options.name.length > 100) {
    throw new TypeError("Component names must be lowercase kebab-case, at most 100 characters.");
  }
  if (typeof options.parseProps !== "function" || typeof options.render !== "function"
    || (options.edit !== undefined && typeof options.edit !== "function")) {
    throw new TypeError("A component requires parseProps and render functions, and an optional edit function.");
  }
  const label = options.label ?? options.name;
  if (typeof label !== "string" || !label.trim()) throw new TypeError("Component labels must be non-empty strings.");
  const definition = Object.freeze({ name: options.name, label }) as ComponentDefinition<TProps>;
  definitions.set(definition, Object.freeze({ ...options }) as unknown as InternalDefinition);
  return definition;
}

export function readDefinition(definition: AnyComponentDefinition): InternalDefinition {
  const internal = definitions.get(definition);
  if (!internal) throw new TypeError("Expected a component created by defineComponent().");
  return internal;
}

export function readRegistry(registry: ComponentRegistry): RegistryState {
  const internal = registries.get(registry);
  if (!internal) throw new TypeError("Expected a registry created by createComponentRegistry().");
  return internal;
}

export function validateProps(definition: AnyComponentDefinition, value: unknown): ComponentProps {
  return snapshotProps(readDefinition(definition).parseProps(snapshotProps(value)));
}

export function serializeProps(definition: AnyComponentDefinition, value: unknown): string {
  const props = snapshotProps(value);
  snapshotProps(readDefinition(definition).parseProps(props));
  return JSON.stringify(props, null, 2);
}

export function createComponentRegistry(initial: readonly AnyComponentDefinition[] = []): ComponentRegistry {
  const state: RegistryState = { definitions: new Map(), listeners: new Set() };
  const notify = (name: string) => { for (const listener of [...state.listeners]) listener(name); };
  const register = (definition: AnyComponentDefinition) => {
    readDefinition(definition);
    if (state.definitions.has(definition.name)) {
      throw new TypeError(`Component "${definition.name}" is already registered.`);
    }
    state.definitions.set(definition.name, definition);
    notify(definition.name);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      state.definitions.delete(definition.name);
      notify(definition.name);
    };
  };
  const registry: ComponentRegistry = Object.freeze({
    register,
    has: (target: AnyComponentDefinition | string) => typeof target === "string"
      ? state.definitions.has(target) : state.definitions.get(target.name) === target,
    get: (name: string) => state.definitions.get(name),
    getAll: () => Object.freeze([...state.definitions.values()]),
  });
  registries.set(registry, state);
  for (const definition of initial) register(definition);
  return registry;
}
