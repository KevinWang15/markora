# markora-ui

Optional default overlays and table controls for `markora`.

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
