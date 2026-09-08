import { useEffect, useRef } from "react";
import { mountBrowserLab } from "../browser-lab/runtime";

export function BrowserLabPage() {
  const labRootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (labRootRef.current) return mountBrowserLab(labRootRef.current);
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
