# Shared React host UI

Private workspace package for the desktop app and demo. It is intentionally separate from the framework-independent `markora` core and `markora-ui` packages.

Use the lazy KaTeX renderer from `@markora/react-ui/renderMath` and the math menu adapter from `@markora/react-ui/mathContextMenu`. The math extension owns its highlighted, in-place source editor; hosts need no math dialog or editing state. Import `markora-extension-math/styles.css` alongside the active Markora theme.

The renderer returns native MathML, loads KaTeX on demand, and disables trusted commands. The app also uses the shared `Dialog` and `Icon` primitives. Import `@markora/react-ui/styles.css` for those host controls.

Source exports are compiled by each host's Vite build and checked by each host's TypeScript configuration. Tests live in `test/` and run with the workspace Vitest suite.
