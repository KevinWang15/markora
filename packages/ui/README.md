# markora-ui

Optional default overlays and table controls for `markora`.

`markora-ui` layers the repo's built-in UI on top of the headless `markora` editor. It is useful when you want polished default controls for links, images, code-fence metadata, and tables without building that overlay behavior yourself.

## What it adds

- named non-modal link editor dialog
- named non-modal image editor dialog
- named non-modal code-fence language/info editor dialog
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

## Localization

Every string rendered by the default overlays—including visible button copy, placeholders, dialog and control names, validation alerts, tooltips, and table status announcements—can be replaced through `createDefaultUi({ messages })`.

```ts
import { createDefaultUi, type DefaultUiMessageOverrides } from "markora-ui";

const messages = {
  cancelButtonLabel: "取消",
  saveButtonLabel: "保存",
  linkDialogLabel: "编辑链接",
  linkUrlInputLabel: "链接地址",
  tableControlLabel(control) {
    return `表格操作：${control}`;
  },
  tableSelectionStatus({ rowFrom, rowTo, columnFrom, columnTo }) {
    return `已选择第 ${rowFrom}–${rowTo} 行、第 ${columnFrom}–${columnTo} 列。`;
  },
  tableActionStatus({ action, selection }) {
    return selection
      ? `${action}；当前范围为第 ${selection.rowFrom}–${selection.rowTo} 行。`
      : action;
  },
} satisfies DefaultUiMessageOverrides;

const ui = createDefaultUi({ messages });
```

Static overrides must be nonblank strings. Dynamic copy uses typed formatter functions so a locale controls word order, plural rules, punctuation, and number formatting instead of combining translated English fragments. Table selection coordinates passed to formatters are one-based and inclusive. `DefaultUiMessages` describes a complete locale, while `DefaultUiMessageOverrides` supports partial overrides and English fallback. `defaultUiMessages` exposes the frozen English defaults for inspection or deliberate composition.

Message options are validated, copied, and frozen when `createDefaultUi()` is called. Unknown keys, invalid values, and blank formatter results throw rather than leaving an unnamed control. Formatters must be pure: Markora preflights every finite table variant and representative selection ranges during creation, then validates each result again when it is used. Later mutations to the source object have no effect. Localization is creation-time configuration; recreate the UI/editor to switch locales. User-authored URLs, image metadata, and code-fence info are document content and are never translated. The embedding host remains responsible for setting the appropriate `lang` and `dir` on its document or portal boundary.

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

## Themes and portal inheritance

The default UI consumes the same public `--mdw-*` colors, typography, spacing,
focus, contrast, and overlay-layer tokens as the core stylesheet. Import the
optional `markora/themes.css` asset for the reference `light`, `dark`, `auto`,
and `contrast` scopes, or provide product tokens directly.

CSS custom properties normally inherit only from the portal's DOM ancestors.
To keep body portals correct, the default UI mirrors the active editor's
effective `--mdw-*` tokens, theme/motion scope, color scheme, language, and
direction onto every owned overlay and follows relevant ancestor/media
changes. Two independently themed editors therefore remain isolated even with
the default body portal. A local `portalRoot` is still useful for a product's
stacking or landmark boundary. When UI DOM is rendered in Shadow DOM, load both
package styles into that root. The complete token and ownership contract is in
[`docs/theme-contract.md`](https://github.com/KevinWang15/markora/blob/main/docs/theme-contract.md).

## Notes

- `markora-ui` is optional; `markora` remains fully usable without it
- link and image dialogs select their primary URL on open, submit text inputs with Enter, cancel with Escape, ignore composition keys, and restore editor focus only when the host has not deliberately moved it elsewhere
- a code block's language label becomes a button that edits its exact complete fence info string; Enter saves, Escape cancels, Save is IME-safe, stale updates are rejected, and focus returns to the label only when the host has not deliberately moved it elsewhere; read-only transitions and teardown close safely
- `editor.ui.createTable()` opens numeric row/column controls initialized to a two-row, three-column table; both dimensions accept whole numbers from 1 through 100
- the table toolbar groups 16 actions as **Row**, **Column**, **Alignment**, and **Table**: insert before/after, move in either direction, delete, automatic/left/center/right alignment, exact logical resizing, and table deletion
- Alt+F10 from a table or `editor.ui.editTable()` moves focus to the toolbar; Left/Right and Home/End use one roving Tab stop and skip actions disabled at a row/column boundary
- alignment uses `aria-pressed`, a polite status describes the active cell rectangle and completed mutations, pointer/focus interaction preserves the editor selection, and Escape or table deletion returns focus unless the host deliberately moved it elsewhere
- Create and Resize use the same owner-document and Shadow DOM-safe non-modal dialog. Submit, Cancel, Escape, read-only transitions, command rejection, and teardown preserve a deliberate focus handoff. Resizing is logical row/column sizing, not pixel-width dragging; shrinking refuses to discard non-empty content
- `markora-ui` does not change parsing or serialization; those guarantees are defined by the [`markora` Markdown compatibility contract](https://github.com/KevinWang15/markora/blob/main/packages/core/MARKDOWN_COMPATIBILITY.md)
- import `markora-ui/styles.css` whenever you use the default UI package
- `markora-ui` declares `markora` as a peer dependency and is intended to track the same package version
