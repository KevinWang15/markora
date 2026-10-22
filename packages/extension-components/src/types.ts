export type ComponentJsonValue = null | boolean | number | string
  | readonly ComponentJsonValue[] | { readonly [key: string]: ComponentJsonValue };

export type ComponentProps = Readonly<Record<string, ComponentJsonValue>>;

type ReadonlyProperties<TValue> = { readonly [Key in keyof TValue]: ComponentReadonly<TValue[Key]> };

export type ComponentReadonly<TValue> = [TValue] extends [ComponentJsonValue]
  ? [ComponentJsonValue] extends [TValue] ? ComponentJsonValue : ReadonlyProperties<TValue>
  : ReadonlyProperties<TValue>;

export type ComponentRenderContext<TProps extends object> = Readonly<{
  element: HTMLElement;
  props: ComponentReadonly<TProps>;
  editable: boolean;
  signal: AbortSignal;
}>;

export type ComponentEditRequest<TProps extends object> = Readonly<{
  anchor: HTMLElement;
  props: ComponentReadonly<TProps>;
  signal: AbortSignal;
  update(props: ComponentReadonly<TProps>): boolean;
  cancel(): void;
}>;

export type ComponentOptions<TProps extends object> = Readonly<{
  name: string;
  label?: string;
  parseProps(value: unknown): TProps;
  render(context: ComponentRenderContext<TProps>): void | (() => void);
  edit?(request: ComponentEditRequest<TProps>): void | (() => void);
}>;

declare const componentDefinitionBrand: unique symbol;
declare const componentPropsBrand: unique symbol;

export type AnyComponentDefinition = Readonly<{
  name: string;
  label: string;
  [componentDefinitionBrand]: true;
}>;

export type ComponentDefinition<TProps extends object> = AnyComponentDefinition & Readonly<{
  [componentPropsBrand]: (props: TProps) => TProps;
}>;

export interface ComponentRegistry {
  register<TProps extends object>(definition: ComponentDefinition<TProps>): () => void;
  has(definitionOrName: AnyComponentDefinition | string): boolean;
  get(name: string): AnyComponentDefinition | undefined;
  getAll(): readonly AnyComponentDefinition[];
}

export type ComponentSnapshot = Readonly<{
  name: string;
  position: number;
  source: string;
}>;

export type ComponentsCommands = Readonly<{
  insert<TProps extends object>(definition: ComponentDefinition<TProps>, props: ComponentReadonly<NoInfer<TProps>>): boolean;
  update<TProps extends object>(definition: ComponentDefinition<TProps>, props: ComponentReadonly<NoInfer<TProps>>, position?: number): boolean;
  updateSource(source: string, position?: number): boolean;
  edit(position?: number): boolean;
  remove(position?: number): boolean;
}>;

export type ComponentsState = Readonly<{
  getNodes(): readonly ComponentSnapshot[];
  getSelected(): ComponentSnapshot | null;
  getProps<TProps extends object>(definition: ComponentDefinition<TProps>, position?: number): ComponentReadonly<TProps> | null;
}>;
