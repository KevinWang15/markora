import "@plantuml/core/viz-global.js";
import "@plantuml/core/themes.js";
import { renderToString } from "@plantuml/core";

// This script is built as one local, self-contained asset. It only runs inside
// the disposable sandbox, never in the editor's window. No remote includes,
// image loads or renderer-written scripts are allowed by the frame's CSP.
Object.assign(globalThis, {
  PLANTUML_STDLIB_LOADER: (_url: string, _ok: () => void, fail: (message: string) => void) => {
    fail("External PlantUML includes are unavailable in local previews.");
    return true;
  },
});

window.addEventListener("message", event => {
  if (event.source !== parent || event.data?.type !== "markora:plantuml:render") return;
  const { id, source } = event.data as { id: number; source: string };
  const reply = (result: { svg: string } | { error: string }) =>
    parent.postMessage({ type: "markora:plantuml:result", id, ...result }, "*");
  if (typeof source !== "string" || source.length > 50_000) {
    reply({ error: "PlantUML source exceeds the preview limit." });
    return;
  }
  try {
    renderToString(source.split(/\r\n?|\n/u), svg => reply({ svg }),
      error => reply({ error }), { maxSvgSize: 8192 });
  } catch (error) { reply({ error: error instanceof Error ? error.message : String(error) }); }
});
parent.postMessage({ type: "markora:plantuml:ready" }, "*");
