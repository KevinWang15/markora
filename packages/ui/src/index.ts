import type { EditorUiFactory, MarkdownEditor } from "markora";
import {
  normalizeDefaultUiMessages,
  type DefaultUiMessageOverrides,
} from "./messages";
import {
  createCodeBlockLanguageEditorOverlay,
  createImageEditorOverlay,
  createLinkEditorOverlay,
  createTableToolbarOverlay,
} from "./overlays";
import { setViewportPosition } from "./positioning";

type EditorView = MarkdownEditor["view"];
type BrowserWindow = Window & typeof globalThis;
type PortalRoot = HTMLElement | ShadowRoot;
type OverlayEnvironmentController = {
  destroy: () => void;
  sync: (
    target: HTMLElement,
    view: EditorView,
    onInvalidated?: () => void,
  ) => void;
};

const THEME_CLASSES = [
  "mdw-theme-auto",
  "mdw-theme-contrast",
  "mdw-theme-dark",
  "mdw-theme-light",
] as const;
const MOTION_CLASSES = ["mdw-motion-reduce"] as const;
const ENVIRONMENT_ATTRIBUTES = ["data-mdw-motion", "data-mdw-theme"] as const;
const ENVIRONMENT_MEDIA_QUERIES = [
  "(forced-colors: active)",
  "(prefers-color-scheme: dark)",
  "(prefers-contrast: more)",
  "(prefers-reduced-motion: reduce)",
] as const;

export type DefaultUiConfig = {
  messages?: DefaultUiMessageOverrides;
  portalRoot?: PortalRoot;
};

export { defaultUiMessages } from "./messages";
export type {
  DefaultUiMessageOverrides,
  DefaultUiMessages,
  DefaultUiTableAction,
  DefaultUiTableActionStatusContext,
  DefaultUiTableControl,
  DefaultUiTableGroup,
  DefaultUiTableMode,
  DefaultUiTableSelectionContext,
} from "./messages";

function resolvePortalRoot(hostElement: HTMLElement, explicitPortalRoot?: PortalRoot) {
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
  candidates: readonly string[],
) {
  for (const element of ancestors) {
    const attributeValue = element.getAttribute(attribute);
    const className = candidates.find((candidate) => element.classList.contains(candidate)) ?? null;

    if (attributeValue !== null || className !== null) {
      return { attributeValue, className };
    }
  }

  return { attributeValue: null, className: null };
}

function createOverlayEnvironmentController(
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
  const observer = new win.MutationObserver(() => invalidateAndSyncAll());
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
        attributes: true,
      });
    }
  };

  const syncTarget = (target: HTMLElement) => {
    if (destroyed || !target.isConnected) {
      targets.delete(target);
      invalidationCallbacks.delete(target);
      return;
    }

    // `dir="auto"` can change the source's computed direction when document
    // text changes without any watched ancestor attribute changing. Refresh
    // this cheap semantic value on every explicit overlay synchronization;
    // the expensive custom-property copy remains version-cached below.
    const computedStyle = win.getComputedStyle(source);
    target.dir = computedStyle.direction === "rtl" ? "rtl" : "ltr";

    const previousSynchronization = synchronizedTargets.get(target);
    if (
      previousSynchronization?.source === source
      && previousSynchronization.version === environmentVersion
    ) {
      return;
    }

    const ancestors = getComposedAncestors(source);
    const themeScope = findEnvironmentScope(
      ancestors,
      "data-mdw-theme",
      THEME_CLASSES,
    );
    const motionScope = findEnvironmentScope(
      ancestors,
      "data-mdw-motion",
      MOTION_CLASSES,
    );
    target.classList.add("mdw-ui");

    for (const candidate of [...THEME_CLASSES, ...MOTION_CLASSES]) {
      target.classList.remove(candidate);
    }

    if (themeScope.className) target.classList.add(themeScope.className);
    if (motionScope.className) target.classList.add(motionScope.className);

    for (const [name, value] of [
      ["data-mdw-theme", themeScope.attributeValue],
      ["data-mdw-motion", motionScope.attributeValue],
    ] as const) {
      if (value === null) {
        target.removeAttribute(name);
      } else {
        target.setAttribute(name, value);
      }
    }

    const language = findInheritedAttribute(ancestors, "lang")
      ?? source.ownerDocument.documentElement.getAttribute("lang");
    if (language !== null) {
      target.setAttribute("lang", language);
    } else {
      target.removeAttribute("lang");
    }
    for (const name of copiedProperties.get(target) ?? []) {
      target.style.removeProperty(name);
    }

    const nextProperties: string[] = [];
    for (let index = 0; index < computedStyle.length; index += 1) {
      const name = computedStyle.item(index);
      if (!name.startsWith("--mdw-")) {
        continue;
      }

      const value = computedStyle.getPropertyValue(name);
      if (value) {
        target.style.setProperty(name, value);
        nextProperties.push(name);
      }
    }
    copiedProperties.set(target, Object.freeze(nextProperties));
    target.style.colorScheme = computedStyle.colorScheme;
    synchronizedTargets.set(target, Object.freeze({
      source,
      version: environmentVersion,
    }));
  };

  function syncAll() {
    for (const target of [...targets]) {
      syncTarget(target);
    }
  }

  function invalidateAndSyncAll() {
    environmentVersion += 1;
    syncAll();

    for (const target of [...targets]) {
      invalidationCallbacks.get(target)?.();
    }
  }

  const handleMediaChange = () => invalidateAndSyncAll();
  for (const query of mediaQueries) {
    query.addEventListener?.("change", handleMediaChange);
  }
  observeAncestors(hostElement);

  return {
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

function releaseEnvironmentWith<T extends { destroy: () => void }>(
  controller: T,
  release: () => void,
): T {
  let destroyed = false;
  return {
    ...controller,
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      try {
        controller.destroy();
      } finally {
        release();
      }
    },
  };
}

export function createDefaultUi(config: DefaultUiConfig = {}): EditorUiFactory {
  const messages = normalizeDefaultUiMessages(config.messages);

  return (options) => {
    const ownerDocument = options.hostElement.ownerDocument;
    const win = ownerDocument.defaultView as BrowserWindow | null;
    const portalRoot = resolvePortalRoot(options.hostElement, config.portalRoot);

    if (!win) {
      throw new Error("Markora UI requires a window-backed document.");
    }

    const environment = createOverlayEnvironmentController(options.hostElement, win);
    let remainingEnvironmentUsers = 4;
    const releaseEnvironment = () => {
      remainingEnvironmentUsers -= 1;
      if (remainingEnvironmentUsers === 0) {
        environment.destroy();
      }
    };

    const linkEditor = releaseEnvironmentWith(createLinkEditorOverlay({
      doc: ownerDocument,
      messages,
      portalRoot,
      removeActiveLink: options.removeActiveLink,
      updateLinkHref: options.updateLinkHref,
      syncEnvironment: environment.sync,
      win,
    }), releaseEnvironment);
    const codeBlockLanguageEditor = releaseEnvironmentWith(createCodeBlockLanguageEditorOverlay({
      doc: ownerDocument,
      messages,
      portalRoot,
      syncEnvironment: environment.sync,
      win,
    }), releaseEnvironment);
    const imageEditor = releaseEnvironmentWith(createImageEditorOverlay({
      doc: ownerDocument,
      messages,
      portalRoot,
      removeActiveImage: options.removeActiveImage,
      syncEnvironment: environment.sync,
      updateActiveImage: options.updateActiveImage,
      win,
    }), releaseEnvironment);
    const tableToolbar = releaseEnvironmentWith(createTableToolbarOverlay({
      addTableColumn: options.addTableColumn,
      addTableRow: options.addTableRow,
      doc: ownerDocument,
      getTableContext: options.getTableContext,
      insertTable: options.insertTable,
      insertTableColumnAt: options.insertTableColumnAt,
      insertTableRowAt: options.insertTableRowAt,
      messages,
      moveTableColumn: options.moveTableColumn,
      moveTableRow: options.moveTableRow,
      normalizeTableAlignment: options.normalizeTableAlignment,
      portalRoot,
      removeActiveTable: options.removeActiveTable,
      removeTableColumn: options.removeTableColumn,
      removeTableRow: options.removeTableRow,
      resizeTable: options.resizeTable,
      selectTableColumn: options.selectTableColumn,
      selectTableRow: options.selectTableRow,
      setTableColumnAlignment: options.setTableColumnAlignment,
      syncEnvironment: environment.sync,
      win,
    }), releaseEnvironment);

    let ephemeralSelectionAnchor: HTMLElement | null = null;

    const clearSelectionAnchor = () => {
      ephemeralSelectionAnchor?.remove();
      ephemeralSelectionAnchor = null;
    };

    const createSelectionAnchor = (view: EditorView) => {
      clearSelectionAnchor();
      const coords = view.coordsAtPos(view.state.selection.from);
      const anchor = ownerDocument.createElement("span");
      anchor.dataset.mdwSelectionAnchor = "true";
      anchor.setAttribute("aria-hidden", "true");
      anchor.style.position = "absolute";
      anchor.style.left = "0";
      anchor.style.top = "0";
      anchor.style.width = "0";
      anchor.style.height = "0";
      anchor.style.pointerEvents = "none";
      portalRoot.append(anchor);
      setViewportPosition(anchor, coords.left, coords.bottom);
      ephemeralSelectionAnchor = anchor;
      return anchor;
    };

    return {
      enabled: true,
      clearSelectionAnchor,
      codeBlockLanguageEditor,
      createSelectionAnchor,
      imageEditor,
      linkEditor,
      tableToolbar,
    };
  };
}
