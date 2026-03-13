import { Link, useLocation } from "react-router-dom";
import { docsNavigation } from "../lib/content";

export function DocPageNav() {
  const { pathname } = useLocation();
  const currentIndex = docsNavigation.findIndex((item) => item.path === pathname);

  if (currentIndex < 0) {
    return null;
  }

  const prev = currentIndex > 0 ? docsNavigation[currentIndex - 1] : null;
  const next = currentIndex < docsNavigation.length - 1 ? docsNavigation[currentIndex + 1] : null;

  if (!prev && !next) {
    return null;
  }

  return (
    <nav className="doc-page-nav" aria-label="Page navigation">
      {prev ? (
        <Link to={prev.path} className="doc-page-nav-link doc-page-nav-prev">
          <span className="doc-page-nav-label">Previous</span>
          <span className="doc-page-nav-title">{prev.title}</span>
        </Link>
      ) : <span />}
      {next ? (
        <Link to={next.path} className="doc-page-nav-link doc-page-nav-next">
          <span className="doc-page-nav-label">Next</span>
          <span className="doc-page-nav-title">{next.title}</span>
        </Link>
      ) : <span />}
    </nav>
  );
}
