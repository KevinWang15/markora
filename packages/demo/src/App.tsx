import { Component, lazy, Suspense, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { defaultDocumentMetadata, publicRouteMetadata } from "./lib/siteRoutes";
import { CodeBlock } from "./components/CodeBlock";
import { docsNavigation, installCommand, quickStartCode } from "./lib/content";
import { GettingStartedPage } from "./pages/GettingStartedPage";
import { builtInThemes, type MarkdownThemeController } from "markora/themes";

const noThemeSubscription = () => () => {};
const defaultThemeSnapshot = () => builtInThemes[0];

const MarkdownCompatibilityPage = lazy(async () => ({
  default: (await import("./pages/MarkdownCompatibilityPage")).MarkdownCompatibilityPage,
}));
const ApiPage = lazy(async () => ({
  default: (await import("./pages/ApiPage")).ApiPage,
}));
const ExamplesPage = lazy(async () => ({
  default: (await import("./pages/ExamplesPage")).ExamplesPage,
}));
const ComponentsPage = lazy(async () => ({
  default: (await import("./pages/ComponentsPage")).ComponentsPage,
}));

const loadEditorPlayground = () => import("./components/EditorPlayground");
const EditorPlayground = lazy(async () => ({
  default: (await loadEditorPlayground()).EditorPlayground,
}));
const DevLabPage = lazy(async () => ({
  default: (await import("./pages/DevLabPage")).DevLabPage,
}));
const BrowserLabPage = lazy(async () => ({
  default: (await import("./pages/BrowserLabPage")).BrowserLabPage,
}));

const editorPlaygroundPreloadDelay = 150;
let editorPlaygroundPreloadTimer: number | undefined;

function preloadEditorPlayground() {
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  }).connection;
  const effectiveType = connection?.effectiveType?.toLowerCase();
  if (
    navigator.onLine === false
    || connection?.saveData === true
    || effectiveType === "slow-2g"
    || effectiveType === "2g"
  ) {
    return;
  }

  void loadEditorPlayground().catch(() => undefined);
}

function scheduleEditorPlaygroundPreload() {
  if (editorPlaygroundPreloadTimer !== undefined) {
    return;
  }

  editorPlaygroundPreloadTimer = window.setTimeout(() => {
    editorPlaygroundPreloadTimer = undefined;
    preloadEditorPlayground();
  }, editorPlaygroundPreloadDelay);
}

function cancelEditorPlaygroundPreload() {
  if (editorPlaygroundPreloadTimer === undefined) {
    return;
  }

  window.clearTimeout(editorPlaygroundPreloadTimer);
  editorPlaygroundPreloadTimer = undefined;
}

class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="panel route-error" role="alert" aria-labelledby="route-error-title">
          <span className="card-kicker">Page unavailable</span>
          <h1 id="route-error-title">This page could not be loaded.</h1>
          <p>The route assets may have been interrupted. Check your connection, then reload to try again.</p>
          <button className="button button-primary" type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}

export function App({ themeController }: Readonly<{ themeController?: MarkdownThemeController }>) {
  const theme = useSyncExternalStore(themeController?.subscribe ?? noThemeSubscription, themeController?.getSnapshot ?? defaultThemeSnapshot);
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/u, "") || "/";
  const navigationType = useNavigationType();
  const previousPathRef = useRef(pathname);
  const currentEntryKeyRef = useRef(location.key);
  const scrollPositionsRef = useRef(new Map<string, { left: number; top: number }>());
  const showHeroBanner = pathname === "/docs/getting-started";
  const isPlaygroundRoute = pathname === "/" || pathname === "/demo";
  const isInternalLabRoute = pathname === "/__dev" || pathname === "/__browser";
  const skipTargetId = showHeroBanner ? "site-hero" : "main-content";

  useLayoutEffect(() => {
    const rememberScrollPosition = () => {
      scrollPositionsRef.current.set(currentEntryKeyRef.current, {
        left: window.scrollX,
        top: window.scrollY,
      });
    };
    const rememberBeforeInternalNavigation = (event: MouseEvent) => {
      const target = event.target;
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (link?.origin === window.location.origin) {
        rememberScrollPosition();
      }
    };

    document.addEventListener("click", rememberBeforeInternalNavigation, true);
    window.addEventListener("popstate", rememberScrollPosition);

    return () => {
      document.removeEventListener("click", rememberBeforeInternalNavigation, true);
      window.removeEventListener("popstate", rememberScrollPosition);
    };
  }, []);

  useLayoutEffect(() => {
    currentEntryKeyRef.current = location.key;
  }, [location.key]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const topbar = document.querySelector<HTMLElement>(".topbar");
    if (!topbar) {
      root.style.removeProperty("--docs-sticky-offset");
      return;
    }

    const syncStickyOffset = () => {
      const style = getComputedStyle(topbar);
      const stickyTop = Number.parseFloat(style.top);
      const offset = style.position === "sticky"
        ? Math.ceil((Number.isFinite(stickyTop) ? stickyTop : 0) + topbar.getBoundingClientRect().height + 12)
        : 0;
      root.style.setProperty("--docs-sticky-offset", `${offset}px`);
    };
    const resizeObserver = new ResizeObserver(syncStickyOffset);
    resizeObserver.observe(topbar);
    window.addEventListener("resize", syncStickyOffset);
    syncStickyOffset();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncStickyOffset);
      root.style.removeProperty("--docs-sticky-offset");
    };
  }, [isInternalLabRoute]);

  useLayoutEffect(() => {
    const routeChanged = previousPathRef.current !== pathname;
    previousPathRef.current = pathname;
    const metadata = publicRouteMetadata[pathname] ?? defaultDocumentMetadata;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const syncKeyboardScrollRegions = () => {
      document.querySelectorAll<HTMLElement>(
        ".docs-site:not(.docs-site-dev) .code-block-pre",
      ).forEach((region) => {
        const overflows = region.scrollWidth > region.clientWidth || region.scrollHeight > region.clientHeight;

        if (overflows) {
          if (!region.hasAttribute("tabindex")) {
            region.tabIndex = 0;
            region.dataset.keyboardScroll = "true";
          }

          const codeDescription = region.dataset.codeDescription;
          if (codeDescription && !region.hasAttribute("role") && !region.hasAttribute("aria-label")) {
            region.setAttribute("role", "group");
            region.setAttribute("aria-label", `${codeDescription}, horizontally scrollable`);
            region.dataset.keyboardScrollSemantics = "true";
          }
          return;
        }

        if (region.dataset.keyboardScroll === "true") {
          region.removeAttribute("tabindex");
          delete region.dataset.keyboardScroll;
        }
        if (region.dataset.keyboardScrollSemantics === "true") {
          region.removeAttribute("role");
          region.removeAttribute("aria-label");
          delete region.dataset.keyboardScrollSemantics;
        }
      });
    };
    const scrollRegionResizeObserver = new ResizeObserver(syncKeyboardScrollRegions);
    const observeKeyboardScrollRegions = () => {
      scrollRegionResizeObserver.disconnect();
      document.querySelectorAll<HTMLElement>(
        ".docs-site:not(.docs-site-dev) .code-block-pre",
      ).forEach((region) => {
        scrollRegionResizeObserver.observe(region);
        const code = region.querySelector<HTMLElement>(":scope > .code-block-code");
        if (code) {
          scrollRegionResizeObserver.observe(code);
        }
      });
      syncKeyboardScrollRegions();
    };
    const scrollRegionObserver = new MutationObserver(observeKeyboardScrollRegions);

    document.title = metadata.title;
    description?.setAttribute("content", metadata.description);

    observeKeyboardScrollRegions();
    window.addEventListener("resize", syncKeyboardScrollRegions);
    const publicSite = document.querySelector(".docs-site:not(.docs-site-dev)");
    if (publicSite) {
      scrollRegionObserver.observe(publicSite, { childList: true, subtree: true });
    }

    const savedScrollPosition = navigationType === "POP"
      ? scrollPositionsRef.current.get(location.key)
      : undefined;
    let restoreFrame = 0;
    if (savedScrollPosition) {
      const restoreScrollPosition = () => {
        window.scrollTo({ behavior: "instant", ...savedScrollPosition });
      };
      restoreScrollPosition();
      restoreFrame = window.requestAnimationFrame(restoreScrollPosition);
    } else if (navigationType !== "POP") {
      window.scrollTo({ behavior: "instant", left: 0, top: 0 });
    }

    if (routeChanged && !isInternalLabRoute) {
      document.getElementById(skipTargetId)?.focus({ preventScroll: true });
    }

    return () => {
      window.cancelAnimationFrame(restoreFrame);
      scrollRegionObserver.disconnect();
      scrollRegionResizeObserver.disconnect();
      window.removeEventListener("resize", syncKeyboardScrollRegions);
      document.querySelectorAll<HTMLElement>(
        ".docs-site:not(.docs-site-dev) .code-block-pre",
      ).forEach((region) => {
        if (region.dataset.keyboardScroll === "true") {
          region.removeAttribute("tabindex");
          delete region.dataset.keyboardScroll;
        }
        if (region.dataset.keyboardScrollSemantics === "true") {
          region.removeAttribute("role");
          region.removeAttribute("aria-label");
          delete region.dataset.keyboardScrollSemantics;
        }
      });
    };
  }, [isInternalLabRoute, location.key, pathname, navigationType, skipTargetId]);

  return (
    <div className={isInternalLabRoute ? "docs-site docs-site-dev" : "docs-site"}>
      {isInternalLabRoute ? null : <a className="skip-link" href={`#${skipTargetId}`}>Skip to content</a>}
      {isInternalLabRoute ? null : (
        <header className="topbar">
          <NavLink className="brand" to="/docs/getting-started">
            <span className="brand-badge">M</span>
            <span>
              <strong>Markora</strong>
              <small>Markdown editor toolkit</small>
            </span>
          </NavLink>
          <nav className="topnav" aria-label="Primary">
            {docsNavigation.map((item) => {
              const isActive = pathname === item.path || (isPlaygroundRoute && item.path === "/demo");
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={isActive ? "topnav-link is-active" : "topnav-link"}
                  aria-current={isActive ? "page" : undefined}
                  onBlur={item.path === "/demo" ? cancelEditorPlaygroundPreload : undefined}
                  onFocus={item.path === "/demo" ? scheduleEditorPlaygroundPreload : undefined}
                  onPointerEnter={item.path === "/demo" ? scheduleEditorPlaygroundPreload : undefined}
                  onPointerLeave={item.path === "/demo" ? cancelEditorPlaygroundPreload : undefined}
                >
                  {item.title}
                </Link>
              );
            })}
            <a className="topnav-link" href="https://github.com/KevinWang15/markora">GitHub</a>
          </nav>
          {themeController && (
            <label className="docs-theme-picker" title={theme.description}>
              <span>Theme</span>
              <select aria-label="Theme" value={theme.id} onChange={event => themeController.setTheme(event.target.value)}>
                {themeController.themes.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          )}
        </header>
      )}

      {showHeroBanner ? (
        <section className="hero-banner panel" aria-labelledby="site-hero-title" id="site-hero" tabIndex={-1}>
          <div>
            <span className="eyebrow">Embedded editor toolkit</span>
            <h1 id="site-hero-title">Production-minded Markdown editing, inside your product.</h1>
            <p>
              Markora combines predictable Markdown fidelity, accessible Typora-style interactions,
              host-owned lifecycle and resources, and eight opt-in syntax packages without taking
              over your application shell.
            </p>
            <div className="hero-actions">
              <NavLink
                to="/demo"
                className="button button-primary"
                onBlur={cancelEditorPlaygroundPreload}
                onFocus={scheduleEditorPlaygroundPreload}
                onPointerEnter={scheduleEditorPlaygroundPreload}
                onPointerLeave={cancelEditorPlaygroundPreload}
              >
                Open core playground
              </NavLink>
              <a className="button button-secondary" href="https://github.com/KevinWang15/markora">Star on GitHub</a>
            </div>
          </div>
          <div className="hero-code">
            <CodeBlock code={installCommand} language="bash" title="Install" showLineNumbers={false} />
            <CodeBlock code={quickStartCode} language="ts" title="Quick start" />
          </div>
        </section>
      ) : null}

      <div className={`docs-layout${isInternalLabRoute ? " docs-layout-dev" : isPlaygroundRoute ? " docs-layout-playground" : ""}`}>
        {isInternalLabRoute || isPlaygroundRoute ? null : <aside className="sidebar panel">
          <nav className="sidebar-section" aria-label="Documentation">
            <span className="card-kicker">Guide</span>
            {docsNavigation.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => isActive ? "sidebar-link is-active" : "sidebar-link"}
                onBlur={item.path === "/demo" ? cancelEditorPlaygroundPreload : undefined}
                onFocus={item.path === "/demo" ? scheduleEditorPlaygroundPreload : undefined}
                onPointerEnter={item.path === "/demo" ? scheduleEditorPlaygroundPreload : undefined}
                onPointerLeave={item.path === "/demo" ? cancelEditorPlaygroundPreload : undefined}
              >
                {item.title}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-section sidebar-callout">
            <span className="card-kicker">Built for embedding</span>
            <p>Predictable Markdown round trips, mature clipboard, table, and code interactions, scoped themes and localization, plus opt-in syntax packages when your product needs them.</p>
          </div>
        </aside>}

        <main
          className={isInternalLabRoute ? "docs-main docs-main-dev" : "docs-main"}
          id={isInternalLabRoute ? undefined : "main-content"}
          tabIndex={isInternalLabRoute ? undefined : -1}
        >
          <RouteErrorBoundary key={pathname}>
            <Suspense fallback={<div className="panel route-loading" role="status">Loading page…</div>}>
              <Routes>
                <Route path="/" element={<EditorPlayground />} />
                <Route path="/docs/getting-started" element={<GettingStartedPage />} />
                <Route path="/docs/markdown" element={<MarkdownCompatibilityPage />} />
                <Route path="/docs/components" element={<ComponentsPage />} />
                <Route path="/docs/api" element={<ApiPage />} />
                <Route path="/docs/examples" element={<ExamplesPage />} />
                <Route path="/demo" element={<EditorPlayground />} />
                <Route path="/__dev" element={<DevLabPage />} />
                <Route path="/__browser" element={<BrowserLabPage />} />
                <Route path="*" element={<Navigate to="/docs/getting-started" replace />} />
              </Routes>
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
