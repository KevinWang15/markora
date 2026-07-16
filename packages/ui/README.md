# markora-ui

Optional default overlays and table controls for `markora`.

`markora-ui` layers the repo's built-in UI on top of the headless `markora` editor. It is useful when you want polished default controls for links, images, and tables without building that overlay behavior yourself.

## What it adds

- named non-modal link editor dialog
- named non-modal image editor dialog
- one-stop, roving-focus table toolbar
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
- the table toolbar uses Left/Right and Home/End navigation, exposes alignment through `aria-pressed`, preserves the editor selection while controls own focus, and returns focus with Escape or after deleting the table
- `markora-ui` does not change parsing or serialization; those guarantees are defined by the [`markora` Markdown compatibility contract](https://github.com/KevinWang15/markora/blob/main/packages/core/MARKDOWN_COMPATIBILITY.md)
- import `markora-ui/styles.css` whenever you use the default UI package
- `markora-ui` declares `markora` as a peer dependency and is intended to track the same package version
