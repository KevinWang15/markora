import type { ContextMenuConfig, ContextMenuContext, ContextMenuItem, ContextMenuMessages, ContextMenuProvider } from "./contextMenuTypes";

const defaults: ContextMenuMessages = Object.freeze({
  menuLabel: "Editor context menu",
  extensionsLabel: "Extensions",
  pendingLabel: "Working…",
  errorLabel: "This action could not be completed. Try again.",
  clipboardErrorLabel: "Clipboard access failed. Allow clipboard access or use the keyboard shortcut.",
  itemLabel: (_id: string, fallback: string) => fallback,
});

export type NormalizedContextMenuConfig = Readonly<ContextMenuConfig & {
  messages: ContextMenuMessages;
  providers: readonly ContextMenuProvider[];
}>;

function nonblank(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a nonblank string.`);
}

export function normalizeContextMenuConfig(config: ContextMenuConfig = {}): NormalizedContextMenuConfig {
  if (!config || typeof config !== "object") throw new TypeError("contextMenu must be a configuration object or false.");
  for (const key of ["includeDefaults", "includeExtensionActions"] as const) {
    if (config[key] !== undefined && typeof config[key] !== "boolean") throw new TypeError(`${key} must be boolean.`);
  }
  for (const key of ["transform", "onError"] as const) {
    if (config[key] !== undefined && typeof config[key] !== "function") throw new TypeError(`${key} must be a function.`);
  }
  const messages = { ...defaults, ...config.messages };
  for (const key of Object.keys(messages)) {
    if (!(key in defaults)) throw new TypeError(`Unknown context menu message: ${key}.`);
    if (key === "itemLabel") {
      if (typeof messages.itemLabel !== "function") throw new TypeError("itemLabel must be a function.");
    } else nonblank(messages[key as Exclude<keyof ContextMenuMessages, "itemLabel">], key);
  }
  if (config.providers !== undefined && !Array.isArray(config.providers)) throw new TypeError("providers must be an array.");
  const ids = new Set<string>();
  const providers = (config.providers ?? []).map(provider => {
    nonblank(provider.id, "Provider ID");
    if (ids.has(provider.id) || provider.id.startsWith("markora.")) throw new TypeError(`Reserved or duplicate provider ID: ${provider.id}.`);
    ids.add(provider.id);
    if (typeof provider.items !== "function" || (provider.order !== undefined && !Number.isFinite(provider.order))) throw new TypeError(`Invalid provider: ${provider.id}.`);
    return Object.freeze({ ...provider });
  });
  if (config.clipboard) {
    for (const key of ["read", "write"] as const) {
      if (config.clipboard[key] !== undefined && typeof config.clipboard[key] !== "function") throw new TypeError(`clipboard.${key} must be a function.`);
    }
  }
  return Object.freeze({ ...config, clipboard: config.clipboard && Object.freeze({ ...config.clipboard }),
    providers: Object.freeze(providers), messages: Object.freeze(messages) });
}

/** Copy and validate the tree so hosts cannot mutate a live menu through their source objects. */
export function snapshotMenuItems(items: readonly ContextMenuItem[], label: ContextMenuMessages["itemLabel"], ids = new Set<string>(), depth = 0): readonly ContextMenuItem[] {
  if (!Array.isArray(items) || depth > 8) throw new TypeError("Menu items must form an array tree at most eight submenu levels deep.");
  const result: ContextMenuItem[] = [];
  for (const item of items) {
    if (item.type === "separator") {
      if (result.length && result[result.length - 1].type !== "separator") result.push(Object.freeze({ type: "separator" }));
      continue;
    }
    nonblank(item.id, "Item ID"); nonblank(item.label, "Item label");
    if (ids.has(item.id)) throw new TypeError(`Duplicate menu item ID: ${item.id}.`);
    ids.add(item.id);
    const localized = label(item.id, item.label); nonblank(localized, `Label for ${item.id}`);
    if (item.type === "submenu") {
      const children = snapshotMenuItems(item.items, label, ids, depth + 1);
      if (children.length) result.push(Object.freeze({ ...item, label: localized, items: children }));
    } else if (item.type === "action" && typeof item.run === "function") {
      for (const key of ["enabled", "checked", "danger"] as const) {
        if (item[key] !== undefined && typeof item[key] !== "boolean") throw new TypeError(`Invalid ${key} for ${item.id}.`);
      }
      if (item.shortcut !== undefined) nonblank(item.shortcut, `Shortcut for ${item.id}`);
      result.push(Object.freeze({ ...item, label: localized }));
    } else throw new TypeError(`Invalid menu item: ${item.id}.`);
  }
  if (result[result.length - 1]?.type === "separator") result.pop();
  return Object.freeze(result);
}

export function reportMenuError(config: NormalizedContextMenuConfig, error: unknown, context: ContextMenuContext) {
  try { config.onError?.(error, context); } catch (reportingError) { console.error("Markora context menu error callback failed.", reportingError); }
}

export function composeMenuItems(config: NormalizedContextMenuConfig, context: ContextMenuContext, builtins: readonly ContextMenuProvider[]): readonly ContextMenuItem[] {
  const providers = [...(config.includeDefaults === false ? [] : builtins), ...config.providers];
  if (config.includeExtensionActions !== false) providers.push({
    id: "markora.extensions", order: 60,
    items: () => [{ type: "submenu", id: "extensions", label: config.messages.extensionsLabel,
      items: [...context.editor.extensions.uiActions].sort((a, b) => a.order - b.order).map(action => ({
        type: "action", id: `extension.${action.id}`, label: action.defaultLabel,
        enabled: context.editor.view.editable && action.isEnabled(), checked: action.isActive(), run: () => action.run(),
      })) }],
  });
  const items: ContextMenuItem[] = [];
  for (const provider of providers.sort((a, b) => (a.order ?? 50) - (b.order ?? 50))) {
    try {
      const next = snapshotMenuItems(provider.items(context), (_id, fallback) => fallback);
      if (next.length) {
        if (items.length) items.push({ type: "separator" });
        items.push(...next);
      }
    } catch (error) { reportMenuError(config, error, context); }
  }
  return snapshotMenuItems(config.transform?.(Object.freeze(items), context) ?? items, config.messages.itemLabel);
}
