# markora-renderers

Optional, local rendering engines for Markora. Constructing a registry loads no
Mermaid, PlantUML, Graphviz, or KaTeX code. The syntax extensions retain the document
model and editable source; this package supplies derived previews only.

```ts
import { createEditor } from "markora";
import { createMathExtension } from "markora-extension-math";
import { createDiagramsExtension } from "markora-extension-diagrams";
import { createRenderers } from "markora-renderers";
import "markora-extension-math/styles.css";
import "markora-extension-diagrams/styles.css";
import "markora-renderers/styles.css";

const renderers = createRenderers();
const math = createMathExtension({ renderer: renderers.math });
const diagrams = createDiagramsExtension({ renderers: renderers.diagrams });
const editor = createEditor({ element, markdown, extensions: [math, diagrams] });

// On host teardown, in this order:
editor.destroy();
renderers.destroy();
```

The same adapters work with `markora/minimal`, independent editors, Shadow DOM,
and non-React hosts. GeoJSON, TopoJSON and STL fences remain supported by the
syntax extension; supply their renderers separately if your host needs previews.

## Loading and lifecycle

- KaTeX loads on the first math preview. It produces native MathML, without web
  fonts or a KaTeX stylesheet, including in exported documents.
- Mermaid loads on the first Mermaid preview. Its individual diagram engines
  retain Mermaid's own lazy loading. Singleton engine calls are serialized.
- PlantUML loads a self-contained local asset only when a preview is requested.
  It runs in a disposable sandboxed frame with no document-origin privileges,
  remote includes, image loads, or network connections. Graphviz is bundled in
  this asset; no Java installation or rendering server is required.
- The extensions activate previews near the viewport, coalesce edits, bound
  concurrency, preserve source on errors, and discard stale results. The registry
  adds a 15-second request deadline (`createRenderers({ timeoutMs })`), shared
  lazy imports, and cancellation while waiting for an engine.
- PlantUML requests are serialized per owner document. Abort or timeout discards
  the active frame; another request can start in a fresh one. Idle frames are
  released after 30 seconds. `destroy()` immediately cancels requests and releases
  every frame owned by the registry. Destroyed registries cannot be reused.

The main editor bundle contains only adapters and asset URLs. Deploy all emitted
assets, including the PlantUML frame script. Vite recognizes its `new URL(...,
import.meta.url)` asset reference, including Pages subpaths and relative app
bases. Hosts with a Content Security Policy must permit their own renderer asset
scripts and `wasm-unsafe-eval` for Graphviz's WebAssembly; JavaScript `unsafe-eval`
is not needed. The frame adds its own stricter policy.

PlantUML uses the official MIT-licensed [`@plantuml/core` browser engine](https://github.com/plantuml/plantuml).
The browser engine does not contain every optional standard library or sprite
pack. Unsupported includes or syntax leave editable source and a retry control.
Its default neutral SVG colors adapt to the inherited CSS `color-scheme` using
`light-dark()`; authored non-default colors remain intact.

## Custom lazy renderers

The extensions accept plain renderer functions. Use `createLazyRenderer` for your
own engine instead of importing that engine in your host's entry point:

```ts
import { createLazyRenderer } from "markora-renderers";

const renderer = createLazyRenderer(async () => {
  const engine = await import("./my-engine.js");
  return engine.render; // request -> owner-document Node/DocumentFragment
});
```

The loader is called once per adapter while pending or successful. Failed loader
promises are evicted for retry (browser module-cache rules still apply). Cancelling
one caller does not poison a shared import, and an already-cancelled request does
not start loading. Engines must still observe the request signal and clean up
resources; cancellation cannot interrupt synchronous JavaScript on the main thread.

The diagram extension's existing DOM clamp remains the final preview boundary.
Adapters remove renderer metadata, not active content; unsafe SVG is rejected.
The app additionally sanitizes standalone export output.
