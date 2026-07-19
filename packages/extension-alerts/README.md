# markora-extension-alerts

Optional semantic GitHub-style alerts for embedded `markora` and
`markora/minimal` editors.

## Install and use

```bash
npm install markora markora-extension-alerts
```

Minimal-entry consumers should import `markora/minimal.css` in place of `markora/styles.css` below.

```ts
import { createEditor } from "markora";
import { createAlertsExtension } from "markora-extension-alerts";
import "markora/styles.css";
import "markora-extension-alerts/styles.css";

const alerts = createAlertsExtension();

const editor = createEditor({
  element,
  extensions: [alerts],
  markdown: "> [!NOTE]\n> Editable body",
});

editor.extensions.get(alerts).commands.setKind("warning");
```

The extension recognizes `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`
markers case-insensitively when the marker is the first blockquote content
line. It serializes the kind in uppercase and keeps the body as ordinary
editable Markdown blocks. No-blank Setext headings and `---` thematic breaks
after an exact marker are recovered from Markdown look-behind; other
non-paragraph first blocks receive a quoted blank separator on output.
Malformed, unknown, escaped, formatted, or titled markers remain ordinary
blockquotes. A marker followed only by `===` is also ordinary Markdown because
that delimiter is not a standalone body block. The demo-only `:::note` dialect
is not accepted.

## Public API

`createAlertsExtension({ messages? })` returns the exact definition handle used
to obtain typed `commands` and `state` from `editor.extensions`.

Commands:

- `wrap(kind?)`
- `toggle(kind?)`
- `setKind(kind)`
- `unwrap()`

State:

- `getActive()` and `getAlerts()`
- `isActive()`
- `canWrap(kind?)`, `canToggle(kind?)`, `canSetKind(kind)`, and `canUnwrap()`

Successful mutations are single extension-origin transactions. Semantic no-ops,
read-only editors, and active composition return `false`.

All package-owned copy can be replaced through a validated partial `messages`
object. `defaultAlertsMessages` and `alertKinds` are frozen exports. Styles are
an explicit import and expose `--mdw-alert-*` variables for host theming.

## Persistence

Persist `editor.extensions.manifest` beside Markdown and restore the same
compatible extension set before editing. Without this package, the base editor
interprets the syntax as an ordinary blockquote and may escape or fold its
marker during serialization.
