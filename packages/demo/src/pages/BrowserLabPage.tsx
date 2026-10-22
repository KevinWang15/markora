import { useEffect, useRef } from "react";
import { mountBrowserLab } from "../browser-lab/runtime";
import { mountComponentsLab } from "../browser-lab/components";

export function BrowserLabPage() {
  const labRootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!labRootRef.current) return;
    const cleanup = mountBrowserLab(labRootRef.current);
    const cleanupComponents = mountComponentsLab(labRootRef.current);
    return () => { cleanupComponents(); cleanup(); };
  }, []);

  return (
    <section
      ref={labRootRef}
      aria-labelledby="browser-lab-title"
      className="browser-lab"
      data-e2e-browser-lab
      data-ready="false"
    >
      <h1 id="browser-lab-title" className="browser-lab-title">
        Markora browser regression lab
      </h1>
    </section>
  );
}
