# markora-ui

Optional default overlays and table controls for `markora`.

`markora-ui` layers the repo's built-in UI on top of the headless `markora` editor. It is useful when you want polished default controls for links, images, and tables without building that overlay behavior yourself.

## What it adds

- named non-modal link editor dialog
- named non-modal image editor dialog
- named table-creation and exact-dimension dialog
- one-stop, roving-focus table toolbar with grouped structural and alignment actions
- Shadow DOM-aware portal placement via `createDefaultUi({ portalRoot })`

## Install

```bash
npm install markora markora-ui
```

## Usage

```ts
import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const editor = createEditor({
  element: document.querySelector("#editor")!,
  markdown: "# Hello Markora",
  ui: createDefaultUi(),
});
```

## Portal root

Pass `portalRoot` when the editor lives inside a Shadow DOM host or another custom DOM boundary and you want the overlays rendered into that same root.

```ts
import { createEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import "markora/styles.css";
import "markora-ui/styles.css";

const shadowRoot = hostElement.attachShadow({ mode: "open" });
const editorMount = document.createElement("div");
shadowRoot.append(editorMount);

const editor = createEditor({
  element: editorMount,
  ui: createDefaultUi({ portalRoot: shadowRoot }),
});
```

## Notes

- `markora-ui` is optional; `markora` remains fully usable without it
- link and image dialogs select their primary URL on open, submit text inputs with Enter, cancel with Escape, ignore composition keys, and restore editor focus only when the host has not deliberately moved it elsewhere
- `editor.ui.createTable()` opens numeric row/column controls initialized to a two-row, three-column table; both dimensions accept whole numbers from 1 through 100
- the table toolbar groups 16 actions as **Row**, **Column**, **Alignment**, and **Table**: insert before/after, move in either direction, delete, automatic/left/center/right alignment, exact logical resizing, and table deletion
- Alt+F10 from a table or `editor.ui.editTable()` moves focus to the toolbar; Left/Right and Home/End use one roving Tab stop and skip actions disabled at a row/column boundary
- alignment uses `aria-pressed`, a polite status describes the active cell rectangle and completed mutations, pointer/focus interaction preserves the editor selection, and Escape or table deletion returns focus unless the host deliberately moved it elsewhere
- Create and Resize use the same owner-document and Shadow DOM-safe non-modal dialog. Submit, Cancel, Escape, read-only transitions, command rejection, and teardown preserve a deliberate focus handoff. Resizing is logical row/column sizing, not pixel-width dragging; shrinking refuses to discard non-empty content
- `markora-ui` does not change parsing or serialization; those guarantees are defined by the [`markora` Markdown compatibility contract](https://github.com/KevinWang15/markora/blob/main/packages/core/MARKDOWN_COMPATIBILITY.md)
- import `markora-ui/styles.css` whenever you use the default UI package
- `markora-ui` declares `markora` as a peer dependency and is intended to track the same package version
