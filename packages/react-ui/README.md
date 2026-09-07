# Shared React host UI

Private workspace package for the desktop app and demo. It is intentionally separate from the framework-independent `markora` core and `markora-ui` packages.

Import `MathDialog` and its `MathEdit` request type from `@markora/react-ui/MathDialog`, and the lazy KaTeX renderer from `@markora/react-ui/renderMath`. Hosts mount `createMathExtension`, own editor selection and document lifecycle, and supply `apply`/`remove` callbacks. A failed callback keeps the dialog open; previews never mutate the document. Import `@markora/react-ui/styles.css` with the host's Markora theme styles.

The shared dialog handles modal focus, cancellation, templates, validation, and abortable previews. Its colors inherit the public `--mdw-*` theme tokens. The renderer returns native MathML, loads KaTeX on demand, and disables trusted commands. The app also uses the shared `Dialog` and `Icon` primitives.

Source exports are compiled by each host's Vite build and checked by each host's TypeScript configuration. Tests live in `test/` and run with the workspace Vitest suite.
