/** Optional, framework-independent themes. Import `markora/themes.css` in each rendering root. */
export type BuiltInThemeId = "auto" | "light" | "dark" | "contrast" | "github" | "newsprint" | "sepia" | "night";
export type MarkdownThemeTokens = Readonly<Partial<Record<`--mdw-${string}`, string>>>;
export type MarkdownTheme = Readonly<{
  id: string;
  label: string;
  description: string;
  colorScheme: "light" | "dark" | "auto";
  /** Reference CSS scope; custom themes inherit its complete palette. */
  cssTheme: BuiltInThemeId;
  tokens: MarkdownThemeTokens;
}>;

function preset(id: BuiltInThemeId, label: string, description: string, colorScheme: MarkdownTheme["colorScheme"]): MarkdownTheme {
  return Object.freeze({ id, label, description, colorScheme, cssTheme: id, tokens: Object.freeze({}) });
}

export const builtInThemes: readonly MarkdownTheme[] = Object.freeze([
  preset("auto", "System", "Follow your system's light or dark appearance.", "auto"),
  preset("light", "Light", "A neutral canvas that inherits your product's typography.", "light"),
  preset("dark", "Dark", "A neutral dark canvas with vivid syntax colors.", "dark"),
  preset("github", "GitHub", "Crisp sans-serif text, ruled headings, and generous code blocks.", "light"),
  preset("newsprint", "Newsprint", "An editorial serif face on a quiet paper canvas.", "light"),
  preset("sepia", "Sepia", "Warm paper, brown ink, and relaxed reading rhythm.", "light"),
  preset("night", "Night", "Soft slate surfaces and muted green accents for evening writing.", "dark"),
  preset("contrast", "High contrast", "System colors and strong focus and selection outlines.", "auto"),
]);

const identifier = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const tokenName = /^--mdw-[a-z][a-z0-9-]*$/u;

function copyTokens(tokens: MarkdownThemeTokens): MarkdownThemeTokens {
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    if (!tokenName.test(name) || typeof value !== "string" || !value.trim()) {
      throw new TypeError(`Invalid Markdown theme token: ${name}`);
    }
    copy[name] = value;
  }
  return Object.freeze(copy);
}

/** Create an immutable theme derived from a reference or another custom theme. */
export function defineTheme(options: Readonly<{
  id: string;
  label: string;
  description?: string;
  extends?: BuiltInThemeId | MarkdownTheme;
  tokens?: MarkdownThemeTokens;
}>): MarkdownTheme {
  if (!identifier.test(options.id) || !options.label?.trim()) {
    throw new TypeError("A theme requires a lowercase kebab-case id and a non-empty label.");
  }
  const base = typeof options.extends === "object" ? options.extends
    : builtInThemes.find(theme => theme.id === (options.extends ?? "light"));
  if (!base || !builtInThemes.some(theme => theme.id === base.cssTheme)) {
    throw new TypeError("A theme must extend a known reference theme.");
  }
  return Object.freeze({
    id: options.id,
    label: options.label.trim(),
    description: options.description ?? "",
    colorScheme: base.colorScheme,
    cssTheme: base.cssTheme,
    tokens: copyTokens({ ...base.tokens, ...options.tokens }),
  });
}

export type MarkdownThemeController = Readonly<{
  themes: readonly MarkdownTheme[];
  getSnapshot: () => MarkdownTheme;
  setTheme: (id: string) => void;
  subscribe: (listener: () => void) => () => void;
  destroy: () => void;
}>;

const owners = new WeakSet<HTMLElement>();

/**
 * Own a theme scope independently of editor state. Persistence is opt-in and
 * best-effort. Each controller has its own catalog; there is no global registry.
 */
export function createThemeController(options: Readonly<{
  element: HTMLElement;
  initialTheme?: string;
  /** Complete catalog. Defaults to builtInThemes; append custom definitions to it. */
  themes?: readonly MarkdownTheme[];
  /** Optional localStorage key, scoped to the element's owning window. */
  storageKey?: string;
}>): MarkdownThemeController {
  const { element, storageKey } = options;
  if (owners.has(element)) throw new Error("This element already has a theme controller.");
  const catalog = new Map<string, MarkdownTheme>();
  for (const theme of options.themes ?? builtInThemes) {
    if (catalog.has(theme.id)) throw new TypeError(`Duplicate theme id: ${theme.id}`);
    const normalized = defineTheme({ ...theme, extends: theme });
    catalog.set(normalized.id, normalized);
  }
  const fallback = catalog.get(options.initialTheme ?? "auto");
  if (!fallback) throw new RangeError(`Unknown initial theme: ${options.initialTheme ?? "auto"}`);
  const win = element.ownerDocument.defaultView;
  let storage: Storage | undefined;
  let current = fallback;
  if (storageKey) {
    try {
      storage = win?.localStorage;
      current = catalog.get(storage?.getItem(storageKey) ?? "") ?? fallback;
    } catch { /* Restricted storage must not prevent an editor from mounting. */ }
  }
  const originalAttributes = new Map(["data-mdw-theme", "data-mdw-theme-id"].map(name => [name, element.getAttribute(name)]));
  const originalClasses = [...element.classList].filter(name => /^mdw-theme-[a-z0-9-]+$/u.test(name));
  const ownedTokens = new Map<string, { value: string; previous: string; priority: string }>();
  const listeners = new Set<() => void>();
  let destroyed = false;

  const releaseTokens = () => {
    for (const [name, saved] of ownedTokens) {
      if (element.style.getPropertyValue(name) === saved.value && !element.style.getPropertyPriority(name)) {
        if (saved.previous) element.style.setProperty(name, saved.previous, saved.priority);
        else element.style.removeProperty(name);
      }
    }
    ownedTokens.clear();
  };
  const apply = () => {
    releaseTokens();
    element.setAttribute("data-mdw-theme", current.cssTheme);
    element.setAttribute("data-mdw-theme-id", current.id);
    for (const [name, value] of Object.entries(current.tokens)) {
      const previous = element.style.getPropertyValue(name);
      const priority = element.style.getPropertyPriority(name);
      element.style.setProperty(name, value!);
      ownedTokens.set(name, { value: element.style.getPropertyValue(name), previous, priority });
    }
  };
  const select = (id: string, persist: boolean) => {
    if (destroyed) throw new Error("Theme controller has been destroyed.");
    const next = catalog.get(id);
    if (!next) throw new RangeError(`Unknown theme: ${id}`);
    if (persist && storageKey) {
      try { storage?.setItem(storageKey, id); } catch { /* Keep the live preference when storage is full or blocked. */ }
    }
    if (next === current) return;
    current = next;
    apply();
    for (const listener of [...listeners]) listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== storage || (event.key !== storageKey && event.key !== null)) return;
    select(catalog.get(event.newValue ?? "")?.id ?? fallback.id, false);
  };
  owners.add(element);
  for (const className of originalClasses) element.classList.remove(className);
  apply();
  if (storageKey && storage) win?.addEventListener("storage", onStorage);

  return Object.freeze({
    themes: Object.freeze([...catalog.values()]),
    getSnapshot: () => current,
    setTheme: (id: string) => select(id, true),
    subscribe(listener: () => void) {
      if (destroyed) throw new Error("Theme controller has been destroyed.");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win?.removeEventListener("storage", onStorage);
      listeners.clear();
      releaseTokens();
      for (const [name, previous] of originalAttributes) {
        const expected = name === "data-mdw-theme" ? current.cssTheme : current.id;
        if (element.getAttribute(name) !== expected) continue;
        if (previous === null) element.removeAttribute(name);
        else element.setAttribute(name, previous);
      }
      for (const className of originalClasses) element.classList.add(className);
      owners.delete(element);
    },
  });
}
