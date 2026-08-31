import { buildLucideIconElement } from "@lucide/icons/build";
import type { LucideIconData } from "@lucide/icons";
import { useLayoutEffect, useRef } from "react";

export function Icon({ icon, size = 18 }: Readonly<{ icon: LucideIconData; size?: number }>) {
  const hostRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren(buildLucideIconElement(document, icon, {
      size,
      strokeWidth: 1.8,
      attributes: { "aria-hidden": "true", focusable: "false" },
    }));
  }, [icon, size]);

  return <span className="app-icon" ref={hostRef} />;
}
