# Editor context menus

## Ownership

Context menus belong to optional `markora-ui`. The core remains headless. An additive UI lifecycle hook, `EditorUiControllers.mount(editor)`, runs after extension setup and may return a cleanup function. Cleanup runs before editor/view teardown, including failed initialization. Existing UI factories remain compatible.

`createDefaultUi({ contextMenu })` enables the shared menu by default; `contextMenu: false` preserves the platform menu. The app and playground use this same implementation. React and syntax renderers are not dependencies of `markora-ui`.

The core also exposes `editor.clipboard.captureSelection()` and `editor.clipboard.paste(content)`. These reuse the native clipboard pipeline and table/extension rules without accessing the system clipboard. Programmatic paste runs custom clipboard handlers and the explicit ProseMirror paste APIs, so modifiers retained from keyboard menu opening cannot silently downgrade rich content. A capture carries immutable formats and a stale-safe `deleteSelection()` callback for deferred Cut. The app supplies a [native NW.js clipboard transport](https://docs.nwjs.io/References/Clipboard/); the webpage uses the browser Clipboard API.

## Separate responsibilities

- `contextMenuTypes.ts`: immutable item, provider, clipboard, localization, and configuration contracts.
- `contextMenuModel.ts`: configuration validation, deterministic provider composition, extension-registry adaptation, item validation, and host transformation.
- `contextMenuDefaults.ts`: built-in actions backed by public editor commands and capability queries.
- `contextMenuClipboard.ts`: browser clipboard transport, deferred Cut/Paste guards, and delegation to the core clipboard API.
- `contextMenuTarget.ts`: pointer/keyboard targeting and selection preservation.
- `contextMenu.ts`: menu session, accessible nested-menu interaction, focus, positioning, async action boundaries, and teardown.
- Existing overlay environment/positioning utilities supply portal, theme, direction, language, and transformed-coordinate behavior.

## Contributions

Providers have stable IDs and numeric order. Each contributes one group of declarative action/submenu/separator items. Actions have stable IDs, labels, optional shortcut hints, capability/checked snapshots, and a command callback. Items are reevaluated on every opening; the renderer owns DOM and keyboard behavior. Providers never manufacture menu DOM.

The existing `editor.extensions.uiActions` registry supplies an Extensions submenu automatically. Syntax needing a source-editing dialog uses a host adapter, keeping syntax packages independent of UI packages. The shared math adapter supplies formula editing, preview toggling, conversion, and removal.

Hosts can disable defaults or extension actions, add providers, and transform the assembled item tree. This supports product-specific history and localization without duplicating menu rendering. The desktop app replaces default Undo/Redo callbacks with its document history, which spans source/rich mode changes.

## Target and session rules

Pointer opening retains a selection if the pointer falls inside it. Otherwise it selects the clicked atom or moves the caret to the clicked text. Keyboard opening (Context Menu key or Shift+F10) uses the current selection. Targeting changes selection only, never document content or history.

Native input controls, nested CodeMirror editors, and interactive overlay controls retain their platform menus. Their text selections belong to their own editing surfaces; outer rich-document commands must not act on them accidentally.

A session captures the document and selection. Document/selection changes, read-only transitions, Escape, outside interaction, scrolling, window changes, and teardown invalidate it. Async clipboard mutations recheck both the snapshot and abort signal after permission/transport awaits. Copy failures never delete text; denied Paste never mutates the document. Callback errors are reported accessibly and through an optional host error callback.

## Interaction and accessibility

Menus use menu/menuitem/menuitemcheckbox roles, roving focus, accessible disabled/checked states, nested submenu relationships, Arrow/Home/End navigation, typeahead, Enter/Space, Escape, and Tab dismissal. Horizontal navigation follows direction. Pointer hover/click and keyboard entry share the same submenu model. Disabled actions remain focusable for discovery but cannot execute. Portalled submenus expose their ownership and control relationships. These behaviors follow the [WAI-ARIA menu pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/).

Panels inherit the active editor's theme, language, and direction, including body portals and Shadow DOM. Each level flips/clamps to the visual viewport and scrolls when necessary. Dismissal restores editor focus only when focus is still owned by the menu; opening a dialog or deliberately moving to another host control wins.

## Verification

Unit coverage exercises configuration/composition, extension contributions, async clipboard races, failed writes, and lifecycle cleanup. Browser/CDP checks cover pointer targeting, preserved selections, nested keyboard navigation, clipboard behavior, contextual table/image/link/math actions, undo/redo, host history, read-only and stale sessions, Shadow DOM, multiple editors, theme inheritance, viewport fit, and screenshots. Pages deployment verifies menu behavior against the production base path.
