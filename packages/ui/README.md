# markora-ui

Optional default overlays and table controls for `markora`.

`markora-ui` layers the repo's built-in UI on top of the headless `markora` editor. It is useful when you want polished default controls for links, images, and tables without building that overlay behavior yourself.

## What it adds

- link editor overlay
- image editor overlay
- table toolbar overlay
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
- import `markora-ui/styles.css` whenever you use the default UI package
- `markora-ui` declares `markora` as a peer dependency and is intended to track the same package version
