import type { MarkdownEditor } from "markora";

type EditorView = MarkdownEditor["view"];
type BrowserWindow = Window & typeof globalThis;
type PortalRoot = HTMLElement | ShadowRoot;
type OverlayEnvironmentController = {
  destroy: () => void;
  release: (target: HTMLElement) => void;
  sync: (
    target: HTMLElement,
    view: EditorView,
    onInvalidated?: () => void,
  ) => void;
};

const isThemeClass = (name: string) => /^mdw-theme-[a-z][a-z0-9-]*$/u.test(name);
const MOTION_CLASSES = ["mdw-motion-reduce"] as const;
const ENVIRONMENT_ATTRIBUTES = ["data-mdw-motion", "data-mdw-theme", "data-mdw-theme-id"] as const;
const ENVIRONMENT_MEDIA_QUERIES = [
  "(forced-colors: active)",
  "(prefers-color-scheme: dark)",
  "(prefers-contrast: more)",
  "(prefers-reduced-motion: reduce)",
] as const;

export function resolvePortalRoot(hostElement: HTMLElement, explicitPortalRoot?: PortalRoot) {
  if (explicitPortalRoot) {
    return explicitPortalRoot;
  }

  const rootNode = hostElement.getRootNode();
  const shadowRootCtor = (hostElement.ownerDocument.defaultView as BrowserWindow | null)?.ShadowRoot;

  return shadowRootCtor && rootNode instanceof shadowRootCtor ? rootNode : hostElement.ownerDocument.body;
}

function getComposedParent(element: Element): Element | null {
  if (element.parentElement) {
    return element.parentElement;
  }

  const root = element.getRootNode();
  const ShadowRootCtor = element.ownerDocument.defaultView?.ShadowRoot;
  return ShadowRootCtor && root instanceof ShadowRootCtor ? root.host : null;
}

function getComposedAncestors(start: HTMLElement) {
  const ancestors: HTMLElement[] = [];
  let current: Element | null = start;

  while (current) {
    const HTMLElementCtor = current.ownerDocument.defaultView?.HTMLElement;
    if (HTMLElementCtor && current instanceof HTMLElementCtor) {
      ancestors.push(current);
    }
    current = getComposedParent(current);
  }

  return ancestors;
}

function sameAncestorChain(
  left: readonly HTMLElement[],
  right: readonly HTMLElement[],
) {
  return left.length === right.length
    && left.every((element, index) => element === right[index]);
}

function findInheritedAttribute(
  ancestors: readonly HTMLElement[],
  name: string,
) {
  for (const element of ancestors) {
    const value = element.getAttribute(name);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function findEnvironmentScope(
  ancestors: readonly HTMLElement[],
  attribute: string,
  candidates: readonly string[] | ((name: string) => boolean),
) {
  for (const element of ancestors) {
    const attributeValue = element.getAttribute(attribute);
    const className = (typeof candidates === "function"
      ? [...element.classList].find(candidates)
      : candidates.find((candidate) => element.classList.contains(candidate))) ?? null;

    if (attributeValue !== null || className !== null) {
      return { attributeValue, className, element };
    }
  }

  return { attributeValue: null, className: null, element: null };
}

export function createOverlayEnvironmentController(
  hostElement: HTMLElement,
  win: BrowserWindow,
): OverlayEnvironmentController {
  let source = hostElement;
  let sourceAncestors = getComposedAncestors(source);
  let destroyed = false;
  let environmentVersion = 0;
  const targets = new Set<HTMLElement>();
  const copiedProperties = new WeakMap<HTMLElement, readonly string[]>();
  const invalidationCallbacks = new WeakMap<HTMLElement, () => void>();
  const synchronizedTargets = new WeakMap<HTMLElement, Readonly<{
    source: HTMLElement;
    version: number;
  }>>();
  const observedElements = new Set<HTMLElement>();
  let lastEnvironmentFingerprint: string | null = null;
  const observer = new win.MutationObserver((records) => {
    const hasEffectiveChange = records.some((record) => (
      record.attributeName !== null
      && record.target instanceof win.Element
      && record.target.getAttribute(record.attributeName) !== record.oldValue
    ));
    if (!hasEffectiveChange) {
      return;
    }
    invalidateAndSyncAll();
  });
  const mediaQueries = typeof win.matchMedia === "function"
    ? ENVIRONMENT_MEDIA_QUERIES.map((query) => win.matchMedia(query))
    : [];

  const observeAncestors = (element: HTMLElement) => {
    for (const ancestor of getComposedAncestors(element)) {
      if (observedElements.has(ancestor)) {
        continue;
      }

      observedElements.add(ancestor);
      observer.observe(ancestor, {
        attributeFilter: ["class", "dir", "lang", "style", ...ENVIRONMENT_ATTRIBUTES],
        attributeOldValue: true,
        attributes: true,
      });
    }
  };

  const readEnvironmentState = () => {
    const computedStyle = win.getComputedStyle(source);
    const dir: "ltr" | "rtl" = computedStyle.direction === "rtl" ? "rtl" : "ltr";
    const ancestors = getComposedAncestors(source);
    const themeScope = findEnvironmentScope(
      ancestors,
      "data-mdw-theme",
      isThemeClass,
    );
    const motionScope = findEnvironmentScope(
      ancestors,
      "data-mdw-motion",
      MOTION_CLASSES,
    );
    const themeId = themeScope.element?.getAttribute("data-mdw-theme-id") ?? null;
    const language = findInheritedAttribute(ancestors, "lang")
      ?? source.ownerDocument.documentElement.getAttribute("lang");
    const customProperties: Array<[string, string]> = [];
    for (let index = 0; index < computedStyle.length; index += 1) {
      const name = computedStyle.item(index);
      if (!name.startsWith("--mdw-")) {
        continue;
      }
      const value = computedStyle.getPropertyValue(name);
      if (value) {
        customProperties.push([name, value]);
      }
    }
    const colorScheme = computedStyle.colorScheme;
    const fingerprint = [
      dir,
      themeScope.className ?? "",
      themeScope.attributeValue ?? "",
      themeId ?? "",
      motionScope.className ?? "",
      motionScope.attributeValue ?? "",
      language ?? "",
      colorScheme,
      ...customProperties.map(([name, value]) => `${name}:${value}`),
    ].join("\0");

    return {
      colorScheme,
      customProperties,
      dir,
      fingerprint,
      language,
      motionScope,
      themeId,
      themeScope,
    };
  };

  type EnvironmentStateSnapshot = ReturnType<typeof readEnvironmentState>;

  const syncTarget = (target: HTMLElement, cachedState?: EnvironmentStateSnapshot) => {
    if (destroyed || !target.isConnected) {
      targets.delete(target);
      invalidationCallbacks.delete(target);
      return;
    }

    const previousSynchronization = synchronizedTargets.get(target);
    if (
      !cachedState
      && previousSynchronization?.source === source
      && previousSynchronization.version === environmentVersion
    ) {
      // `dir="auto"` can change the source's computed direction when document
      // text changes without any watched ancestor attribute changing. Refresh
      // this cheap semantic value on every explicit overlay synchronization;
      // the expensive custom-property copy remains version-cached below.
      const nextDir = win.getComputedStyle(source).direction === "rtl" ? "rtl" : "ltr";
      if (target.dir !== nextDir) {
        target.dir = nextDir;
      }
      return;
    }

    const state = cachedState ?? readEnvironmentState();
    lastEnvironmentFingerprint = state.fingerprint;
    if (target.dir !== state.dir) {
      target.dir = state.dir;
    }
    target.classList.add("mdw-ui");

    for (const candidate of [...target.classList].filter(name => isThemeClass(name) || MOTION_CLASSES.some(motion => motion === name))) {
      target.classList.remove(candidate);
    }

    if (state.themeScope.className) target.classList.add(state.themeScope.className);
    if (state.motionScope.className) target.classList.add(state.motionScope.className);

    for (const [name, value] of [
      ["data-mdw-theme", state.themeScope.attributeValue],
      ["data-mdw-theme-id", state.themeId],
      ["data-mdw-motion", state.motionScope.attributeValue],
    ] as const) {
      if (value === null) {
        target.removeAttribute(name);
      } else {
        target.setAttribute(name, value);
      }
    }

    if (state.language !== null) {
      target.setAttribute("lang", state.language);
    } else {
      target.removeAttribute("lang");
    }
    for (const name of copiedProperties.get(target) ?? []) {
      target.style.removeProperty(name);
    }

    const nextProperties: string[] = [];
    for (const [name, value] of state.customProperties) {
      target.style.setProperty(name, value);
      nextProperties.push(name);
    }
    copiedProperties.set(target, Object.freeze(nextProperties));
    target.style.colorScheme = state.colorScheme;
    synchronizedTargets.set(target, Object.freeze({
      source,
      version: environmentVersion,
    }));
  };

  function syncAll(cachedState?: EnvironmentStateSnapshot) {
    const state = cachedState ?? (targets.size > 0 ? readEnvironmentState() : undefined);
    for (const target of [...targets]) {
      syncTarget(target, state);
    }
  }

  function invalidateAndSyncAll() {
    const state = readEnvironmentState();
    const environmentChanged = state.fingerprint !== lastEnvironmentFingerprint;

    if (environmentChanged) {
      environmentVersion += 1;
      syncAll(state);
    }

    const callbacks = new Set<() => void>();
    for (const target of [...targets]) {
      const callback = invalidationCallbacks.get(target);
      if (callback) {
        callbacks.add(callback);
      }
    }
    for (const callback of callbacks) {
      callback();
    }
  }

  const handleMediaChange = () => invalidateAndSyncAll();
  for (const query of mediaQueries) {
    query.addEventListener?.("change", handleMediaChange);
  }
  observeAncestors(hostElement);

  return {
    release(target) {
      targets.delete(target);
      invalidationCallbacks.delete(target);
    },
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      observer.disconnect();
      for (const query of mediaQueries) {
        query.removeEventListener?.("change", handleMediaChange);
      }
      for (const target of targets) {
        invalidationCallbacks.delete(target);
      }
      targets.clear();
      observedElements.clear();
    },
    sync(target, view, onInvalidated) {
      if (destroyed) {
        return;
      }

      const nextSource = view.dom instanceof win.HTMLElement ? view.dom : hostElement;
      const sourceChanged = source !== nextSource;
      if (sourceChanged) {
        source = nextSource;
      }
      targets.add(target);
      if (onInvalidated) {
        invalidationCallbacks.set(target, onInvalidated);
      }
      const nextAncestors = getComposedAncestors(source);
      const ancestorsChanged = sourceChanged
        || !sameAncestorChain(sourceAncestors, nextAncestors);
      if (ancestorsChanged) {
        sourceAncestors = nextAncestors;
        environmentVersion += 1;
      }
      observeAncestors(source);

      if (ancestorsChanged) {
        syncAll();
        for (const peer of [...targets]) {
          if (peer !== target) {
            invalidationCallbacks.get(peer)?.();
          }
        }
        return;
      }

      syncTarget(target);
    },
  };
}

