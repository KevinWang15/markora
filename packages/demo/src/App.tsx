import { useLayoutEffect } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CodeBlock } from "./components/CodeBlock";
import { EditorPlayground } from "./components/EditorPlayground";
import { docsNavigation, installCommand, quickStartCode } from "./lib/content";
import { ApiPage } from "./pages/ApiPage";
import { BrowserLabPage } from "./pages/BrowserLabPage";
import { ExamplesPage } from "./pages/ExamplesPage";
import { DevLabPage } from "./pages/DevLabPage";
import { GettingStartedPage } from "./pages/GettingStartedPage";
import { MarkdownCompatibilityPage } from "./pages/MarkdownCompatibilityPage";

const defaultDocumentMetadata = {
  title: "Markora — Embedded Markdown Editor",
  description: "Markora is a production-minded embedded Markdown editor with predictable fidelity, accessible interactions, host-owned lifecycle, and opt-in syntax packages.",
};

const publicRouteMetadata: Record<string, typeof defaultDocumentMetadata> = {
  "/": {
    title: "Getting Started — Markora",
    description: "Install Markora, mount the embedded Markdown editor, and add only the UI and syntax packages your product needs.",
  },
  "/docs/getting-started": {
    title: "Getting Started — Markora",
    description: "Install Markora, mount the embedded Markdown editor, and add only the UI and syntax packages your product needs.",
  },
  "/docs/markdown": {
    title: "Markdown Compatibility — Markora",
    description: "Review Markora's published Markdown dialect, exact-source fallback behavior, and opt-in semantic syntax packages.",
  },
  "/docs/api": {
    title: "API Reference — Markora",
    description: "Explore Markora's typed editor API for commands, state, events, reconciliation, resources, extensions, and teardown.",
  },
  "/docs/examples": {
    title: "Embedding Examples — Markora",
    description: "Use practical Markora recipes for framework lifecycles, host-owned persistence, scoped UI, and optional Markdown syntax.",
  },
  "/demo": {
    title: "Core Playground — Markora",
    description: "Try Markora's embedded core editor and optional UI in a realistic host-controlled playground.",
  },
};

export function App() {
  const location = useLocation();
  const showHeroBanner = location.pathname === "/" || location.pathname === "/docs/getting-started";
  const isInternalLabRoute = location.pathname === "/__dev" || location.pathname === "/__browser";
  const skipTargetId = showHeroBanner ? "site-hero" : "main-content";

  useLayoutEffect(() => {
    const root = document.documentElement;
    const inlineScrollBehavior = root.style.scrollBehavior;
    const metadata = publicRouteMetadata[location.pathname] ?? defaultDocumentMetadata;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const keyboardScrollRegions = Array.from(
      document.querySelectorAll<HTMLElement>(".docs-site:not(.docs-site-dev) .code-block-pre"),
    );
    const syncKeyboardScrollRegions = () => {
      keyboardScrollRegions.forEach((region) => {
        const overflows = region.scrollWidth > region.clientWidth || region.scrollHeight > region.clientHeight;

        if (overflows && !region.hasAttribute("tabindex")) {
          region.tabIndex = 0;
          region.dataset.keyboardScroll = "true";
        } else if (!overflows && region.dataset.keyboardScroll === "true") {
          region.removeAttribute("tabindex");
          delete region.dataset.keyboardScroll;
        }
      });
    };

    document.title = metadata.title;
    description?.setAttribute("content", metadata.description);

    syncKeyboardScrollRegions();
    window.addEventListener("resize", syncKeyboardScrollRegions);

    root.style.scrollBehavior = "auto";
    root.scrollTop = 0;
    document.body.scrollTop = 0;
    root.style.scrollBehavior = inlineScrollBehavior;

    return () => {
      window.removeEventListener("resize", syncKeyboardScrollRegions);
      keyboardScrollRegions.forEach((region) => {
        if (region.dataset.keyboardScroll === "true") {
          region.removeAttribute("tabindex");
          delete region.dataset.keyboardScroll;
        }
      });
    };
  }, [location.pathname]);

  return (
    <div className={isInternalLabRoute ? "docs-site docs-site-dev" : "docs-site"}>
      {isInternalLabRoute ? null : <a className="skip-link" href={`#${skipTargetId}`}>Skip to content</a>}
      {isInternalLabRoute ? null : (
        <header className="topbar">
          <NavLink className="brand" to="/docs/getting-started">
            <span className="brand-badge">M</span>
            <span>
              <strong>Markora</strong>
              <small>Embedded Markdown editing for modern products</small>
            </span>
          </NavLink>
          <nav className="topnav" aria-label="Primary">
            {docsNavigation.map((item) => (
              <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? "topnav-link is-active" : "topnav-link"}>
                {item.title}
              </NavLink>
            ))}
            <a className="topnav-link" href="https://github.com/KevinWang15/markora">GitHub</a>
          </nav>
        </header>
      )}

      {showHeroBanner ? (
        <section className="hero-banner panel" aria-labelledby="site-hero-title" id="site-hero" tabIndex={-1}>
          <div>
            <span className="eyebrow">Embedded editor toolkit</span>
            <h1 id="site-hero-title">Production-minded Markdown editing, inside your product.</h1>
            <p>
              Markora combines predictable Markdown fidelity, accessible Typora-style interactions,
              host-owned lifecycle and resources, and seven opt-in syntax packages without taking
              over your application shell.
            </p>
            <div className="hero-actions">
              <NavLink to="/demo" className="button button-primary">Open core playground</NavLink>
              <a className="button button-secondary" href="https://github.com/KevinWang15/markora">Star on GitHub</a>
            </div>
          </div>
          <div className="hero-code">
            <CodeBlock code={installCommand} language="bash" title="Install" showLineNumbers={false} />
            <CodeBlock code={quickStartCode} language="ts" title="Quick start" />
          </div>
        </section>
      ) : null}

      <div className={isInternalLabRoute ? "docs-layout docs-layout-dev" : "docs-layout"}>
        {isInternalLabRoute ? null : <aside className="sidebar panel">
          <div className="sidebar-section">
            <span className="card-kicker">Guide</span>
            {docsNavigation.map((item) => (
              <NavLink key={item.path} to={item.path} className={({ isActive }) => isActive ? "sidebar-link is-active" : "sidebar-link"}>
                {item.title}
              </NavLink>
            ))}
          </div>
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
          <Routes>
            <Route path="/" element={<Navigate to="/docs/getting-started" replace />} />
            <Route path="/docs/getting-started" element={<GettingStartedPage />} />
            <Route path="/docs/markdown" element={<MarkdownCompatibilityPage />} />
            <Route path="/docs/api" element={<ApiPage />} />
            <Route path="/docs/examples" element={<ExamplesPage />} />
            <Route path="/demo" element={<EditorPlayground />} />
            <Route path="/__dev" element={<DevLabPage />} />
            <Route path="/__browser" element={<BrowserLabPage />} />
            <Route path="*" element={<Navigate to="/docs/getting-started" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
