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

export function App() {
  const location = useLocation();
  const showHeroBanner = location.pathname === "/" || location.pathname === "/docs/getting-started";
  const isInternalLabRoute = location.pathname === "/__dev" || location.pathname === "/__browser";

  useLayoutEffect(() => {
    const root = document.documentElement;
    const inlineScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    root.scrollTop = 0;
    document.body.scrollTop = 0;
    root.style.scrollBehavior = inlineScrollBehavior;
  }, [location.pathname]);

  return (
    <div className={isInternalLabRoute ? "docs-site docs-site-dev" : "docs-site"}>
      {isInternalLabRoute ? null : (
        <header className="topbar">
          <NavLink className="brand" to="/docs/getting-started">
            <span className="brand-badge">M</span>
            <span>
              <strong>Markora</strong>
              <small>Typora-style editing for modern web apps</small>
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
        <div className="hero-banner panel">
          <div>
            <span className="eyebrow">Documentation</span>
            <h1>Build Markdown workflows your users actually enjoy.</h1>
            <p>
              Markora pairs a headless Markdown editor with optional built-in overlays, lazy-loaded
              code-block languages, and a documented semantic round-trip contract with predictable
              normalized output for supported syntax.
            </p>
            <div className="hero-actions">
              <NavLink to="/demo" className="button button-primary">Open live demo</NavLink>
              <a className="button button-secondary" href="https://github.com/KevinWang15/markora">Star on GitHub</a>
            </div>
          </div>
          <div className="hero-code">
            <CodeBlock code={installCommand} language="bash" title="Install" showLineNumbers={false} />
            <CodeBlock code={quickStartCode} language="ts" title="Quick start" />
          </div>
        </div>
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
            <span className="card-kicker">Why it stands out</span>
            <p>Headless core, optional <code>markora-ui</code> overlays, extensible code-block languages, and an internal <code>/__dev</code> lab for regression work.</p>
          </div>
        </aside>}

        <main className={isInternalLabRoute ? "docs-main docs-main-dev" : "docs-main"}>
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
