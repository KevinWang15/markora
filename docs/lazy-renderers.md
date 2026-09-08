# Lazy rendering architecture

Document semantics, preview scheduling, and engine loading have separate owners:

1. `markora` owns editor transactions, selections, history and extension contracts.
2. Math and diagram extensions own Markdown syntax, source editing, viewport
   activation, render generations and their final DOM clamps. They import no engines.
3. `markora-renderers` owns optional engines and their resource lifetimes. Its
   registry is independent of React, the app and the playground.
4. Hosts construct a registry and connect its callbacks to extensions. The app's
   HTML/PDF exporter uses the same registry and destroys it after serialization.

The diagram vocabulary now includes PlantUML. Fence info and source remain model
text; every supported PlantUML diagram family uses the same node type and editing
rules. Unsupported engines still display source. Adding a rendering engine does
not create another editor selection model or duplicate node-view lifecycle code.

`createLazyRenderer` caches a loader promise, clears failed loads, and gives each
caller independent cancellation. KaTeX returns MathML. Mermaid's module is lazy,
its automatic page scan is disabled, and singleton layout work is serialized.
PlantUML's generated browser engine depends on DOM layout and shared state, so it
runs in a local, opaque-origin frame with a small request/result protocol. Sender
window and request ID must match. The frame can be discarded after abort or
timeout; it cannot fetch remote includes or access the editor DOM. Its compiled
asset has a build-time syntax check because aggressive minification of the
upstream generated code can damage JavaScript labels.

Host teardown first destroys editors, then the renderer registry. React hosts
create registries within their editor effects so Strict Mode remounts receive new
live registries. Export takes a document/theme snapshot and uses a short-lived
registry; renderer errors preserve source in the exported output.

Validation covers failed/repeated imports, concurrent callers, cancellation,
frame queues, idle release, teardown, real SVG compatibility, browser network
requests, source editing, and HTML/PDF output. Core performance fixtures and
budgets retain their existing scope; rendering engine assets are optional and
are checked separately from the renderer-free core bundle.
