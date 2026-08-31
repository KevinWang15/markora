# Markora theme and visual-ownership contract

Markora's styles are an explicit, host-overridable layer for the editable document and the optional default UI. The embedding product still owns the surrounding page, toolbar, typography context, responsive layout, and any product-specific controls.

Import the base stylesheet that matches the editor entry, plus the optional UI stylesheet when it is used:

```ts
import "markora/styles.css"; // or "markora/minimal.css"
import "markora-ui/styles.css"; // only with createDefaultUi()
```

Every visual value in those styles is read through a namespaced `--mdw-*` custom property with a component default. A host can override one token, a component family, or the complete palette without copying Markora selectors.

## Reference themes

`markora/themes.css` is optional. It provides reviewed light, dark, automatic, and higher-contrast token sets without changing unthemed consumers:

```ts
import "markora/styles.css";
import "markora/themes.css";
import "markora-ui/styles.css";
```

Put one reference scope on an ancestor of the editor:

```html
<section data-mdw-theme="auto">
  <div id="editor"></div>
  <div id="editor-portals"></div>
</section>
```

The equivalent classes are `.mdw-theme-light`, `.mdw-theme-dark`, `.mdw-theme-auto`, and `.mdw-theme-contrast`. An explicit `light` or `dark` scope is stable regardless of the operating-system color preference. `auto` starts from the reference light palette and follows `prefers-color-scheme`; all three ordinary reference scopes strengthen borders under `prefers-contrast: more`. `contrast` uses CSS system colors and thicker outlines. Windows forced-colors mode is honored automatically by the base and UI styles, including focus, table/cell selection, node selection, task state, caret, and text selection indicators.

Custom declarations after the reference import win normally:

```css
.document-editor {
  --mdw-color-accent: var(--product-accent);
  --mdw-color-focus: var(--product-focus-ring);
  --mdw-editor-background: var(--product-canvas);
  --mdw-editor-radius: var(--product-radius-lg);
  --mdw-font-mono: var(--product-font-mono);
  --mdw-ui-z-index: var(--product-overlay-layer);
}
```

Custom properties inherit through the DOM. Because default UI is often portaled outside the editor subtree, `markora-ui` mirrors the active editor's effective `--mdw-*` properties, theme/motion scope, `color-scheme`, language, and direction onto each owned overlay. It resynchronizes when the relevant editor/ancestor attributes or user media preferences change, so body-portaled overlays remain isolated when two editors use different themes. An explicit same-scope `portalRoot` is still useful when the product needs a local stacking/landmark boundary or wants the portal to participate naturally in its layout. In Shadow DOM, the host remains responsible for loading the package styles into every shadow root that renders editor or UI DOM.

## Reduced motion

The editor automatically honors `prefers-reduced-motion: reduce`: custom caret blinking, the image-loading spinner, CodeMirror cursor blinking, and decorative transitions stop. Loading and selection state remain available through text, ARIA state, borders, and outlines. A host can force the same reference behavior within a subtree with `.mdw-motion-reduce` or `data-mdw-motion="reduce"`.

The motion hooks are `--mdw-motion-duration-fast` (default `120ms`), `--mdw-caret-animation` (the complete caret animation), and `--mdw-spinner-animation` (the complete image-spinner animation).

## Public color and effect tokens

The reference values live in `markora/themes.css`; the unthemed fallback remains the pre-contract appearance.

| Tokens | Responsibility |
| --- | --- |
| `--mdw-color-scheme`, `--mdw-editor-color`, `--mdw-editor-background` | Native-control scheme and outer editable canvas |
| `--mdw-color-text`, `--mdw-color-muted`, `--mdw-color-placeholder`, `--mdw-color-disabled`, `--mdw-color-marker`, `--mdw-color-quote` | Text roles |
| `--mdw-color-surface`, `--mdw-color-surface-subtle`, `--mdw-color-surface-muted` | Canvas, code/table/control, and header surfaces |
| `--mdw-color-border`, `--mdw-color-border-strong` | Ordinary and emphasized boundaries |
| `--mdw-color-accent`, `--mdw-color-accent-strong`, `--mdw-color-accent-soft`, `--mdw-color-accent-softer` | Links, active controls, and selection surfaces |
| `--mdw-color-focus`, `--mdw-color-focus-soft`, `--mdw-color-selection`, `--mdw-color-selection-overlay`, `--mdw-color-selection-text` | Focus and selection indicators |
| `--mdw-color-success`, `--mdw-color-important`, `--mdw-color-warning`, `--mdw-color-danger`, `--mdw-color-danger-soft` | Positive, emphasized, warning, and failure state |
| `--mdw-color-caret`, `--mdw-color-caret-contrast` | Gap, managed-block, and code caret roles |
| `--mdw-shadow-caret`, `--mdw-shadow-subtle`, `--mdw-shadow-control`, `--mdw-shadow-overlay`, `--mdw-code-block-inset-shadow`, `--mdw-task-checked-shadow` | Elevation and contrast effects; reference contrast modes remove nonessential shadows |
| `--mdw-syntax-keyword`, `--mdw-syntax-literal`, `--mdw-syntax-name`, `--mdw-syntax-property`, `--mdw-syntax-string`, `--mdw-syntax-comment`, `--mdw-syntax-type`, `--mdw-syntax-operator` | Code syntax roles shared by static and active code blocks |
| `--mdw-task-background`, `--mdw-task-checked-background`, `--mdw-task-checked-color`, `--mdw-image-status-background`, `--mdw-code-active-line-background` | Component-specific state fills |

Do not encode meaning only in a custom color. The supplied DOM keeps checked state, validation text, selection outlines, disabled state, and live status semantics available independently of the palette. Hosts replacing those indicators assume responsibility for equivalent contrast and non-color cues.

## Public typography, spacing, and geometry tokens

Defaults shown here are the component defaults. Zeroes, percentages, viewport-coordinate positioning, and visually-hidden clipping remain structural invariants rather than theme choices.

### Editor and common controls

| Token | Default |
| --- | --- |
| `--mdw-editor-min-block-size` | `180px` |
| `--mdw-editor-padding` | `12px` |
| `--mdw-editor-radius` | `8px` |
| `--mdw-border-width` | `1px` |
| `--mdw-block-spacing` | `0.75rem` |
| `--mdw-control-min-size` | `44px` |
| `--mdw-control-radius` | `0.5rem` |
| `--mdw-focus-ring-width`, `--mdw-selection-ring-width` | `2px` |
| `--mdw-focus-halo-width` | `3px` |
| `--mdw-focus-ring-offset`, `--mdw-selection-ring-offset` | `2px` |
| `--mdw-radius-pill` | `999px` |
| `--mdw-font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |
| `--mdw-label-font-size`, `--mdw-label-font-weight`, `--mdw-label-letter-spacing` | `0.75rem`, `600`, `0.06em` |
| `--mdw-disabled-opacity` | component default (`0.7` or `0.72`) |
| `--mdw-layer-selection`, `--mdw-layer-content`, `--mdw-layer-cursor` | `1`, `2`, `3` (internal relative stack) |
| `--mdw-visually-hidden-size` | `1px` (accessibility invariant; do not override) |

### Document typography and block layout

| Token | Default |
| --- | --- |
| `--mdw-heading-font-weight` | `700` |
| `--mdw-heading-1-font-size`, `--mdw-heading-1-line-height` | `2rem`, `1.2` |
| `--mdw-heading-2-font-size`, `--mdw-heading-2-line-height` | `1.5rem`, `1.3` |
| `--mdw-heading-3-font-size`, `--mdw-heading-3-line-height` | `1.25rem`, `1.35` |
| `--mdw-heading-4-font-size`, `--mdw-heading-4-line-height` | `1.125rem`, `1.4` |
| `--mdw-heading-5-font-size`, `--mdw-heading-5-line-height` | `1rem`, `1.45` |
| `--mdw-heading-6-font-size`, `--mdw-heading-6-line-height` | `0.875rem`, `1.5` |
| `--mdw-rule-margin-block` | `1rem` |
| `--mdw-blockquote-padding-inline`, `--mdw-blockquote-border-width` | `1rem`, `3px` |
| `--mdw-list-indent`, `--mdw-list-item-spacing`, `--mdw-list-nested-spacing` | `1.5rem`, `0.25rem`, `0.2rem` |
| `--mdw-table-cell-padding-block`, `--mdw-table-cell-padding-inline`, `--mdw-table-heading-font-weight` | `0.55rem`, `0.75rem`, `600` |
| `--mdw-inline-code-padding-block`, `--mdw-inline-code-padding-inline`, `--mdw-inline-code-radius`, `--mdw-inline-code-font-size` | `0.15em`, `0.35em`, `0.375rem`, `0.9em` |

### Carets, tasks, images, and preserved source

| Token | Default |
| --- | --- |
| `--mdw-cursor-width`, `--mdw-cursor-radius`, `--mdw-gap-cursor-height`, `--mdw-gap-cursor-offset`, `--mdw-managed-cursor-inset-block` | `1px`, `1px`, `1.2em`, `8px`, `8px` |
| `--mdw-task-content-min-block-size`, `--mdw-task-control-size`, `--mdw-task-control-offset-block`, `--mdw-task-control-offset-inline` | `1.5rem`, `2.75rem`, `-0.625rem`, `0.5rem` |
| `--mdw-task-indicator-size`, `--mdw-task-indicator-border-width`, `--mdw-task-indicator-radius` | `1.125rem`, `1.5px`, `0.375rem` |
| `--mdw-task-check-font-size`, `--mdw-task-check-font-weight` | `0.84rem`, `700` |
| `--mdw-image-radius`, `--mdw-image-gap`, `--mdw-image-block-margin` | `10px`, `8px`, `0.5rem` |
| `--mdw-image-frame-min-size`, `--mdw-image-status-padding`, `--mdw-image-spinner-size`, `--mdw-image-spinner-border-width` | `48px`, `12px`, `20px`, `2px` |
| `--mdw-image-source-font-size`, `--mdw-image-source-opacity`, `--mdw-image-status-font-size`, `--mdw-image-status-text-opacity`, `--mdw-image-loading-opacity` | `0.95em`, `0.72`, `12px`, `0.8`, `0.35` |
| `--mdw-opaque-block-radius`, `--mdw-opaque-inline-radius`, `--mdw-opaque-control-radius` | `10px`, `5px`, `6px` |
| `--mdw-opaque-header-padding-block`, `--mdw-opaque-header-padding-inline`, `--mdw-opaque-source-padding` | `0.5rem`, `0.75rem`, `0.75rem` |
| `--mdw-opaque-control-padding-block`, `--mdw-opaque-control-padding-inline` | `0.25rem`, `0.55rem` |
| `--mdw-opaque-inline-gap`, `--mdw-opaque-inline-control-margin`, `--mdw-opaque-source-max-block-size` | `0.25rem`, `0.2rem`, `18rem` |
| `--mdw-marker-font-weight` | `400` |

### Code blocks

Code surfaces default to LTR independently of the surrounding document, while Unicode bidirectional text within a line remains supported. Hosts may override `direction` on both `.mdw-code-block-static` and `.cm-editor` together if their code dialect requires a different base direction.

| Token | Default |
| --- | --- |
| `--mdw-code-block-radius`, `--mdw-code-font-size`, `--mdw-code-line-height`, `--mdw-code-line-min-block-size` | `12px`, `0.875rem`, `1.65`, `1.65em` |
| `--mdw-code-padding-block`, `--mdw-code-padding-inline` | `0.875rem`, `0.875rem` |
| `--mdw-code-gutter-min-inline-size`, `--mdw-code-gutter-padding-start`, `--mdw-code-gutter-padding-end` | `2.5rem`, `0.75rem`, `0.625rem` |
| `--mdw-code-language-padding-block`, `--mdw-code-language-padding-inline`, `--mdw-code-language-letter-spacing` | `0.625rem`, `0.875rem`, `0.08em` |

### Optional default UI

| Token | Default |
| --- | --- |
| `--mdw-ui-font-family`, `--mdw-ui-font-size` | inherited from the portal scope |
| `--mdw-ui-z-index` | `30` (the size dialog uses the next layer) |
| `--mdw-ui-overlay-inline-size`, `--mdw-ui-image-overlay-inline-size`, `--mdw-ui-table-overlay-inline-size` | `280px`, `320px`, `300px` |
| `--mdw-ui-viewport-gutter`, `--mdw-ui-overlay-padding`, `--mdw-ui-overlay-radius` | `24px`, `10px`, `10px` |
| `--mdw-ui-gap`, `--mdw-ui-form-gap`, `--mdw-ui-field-gap` | `8px`, `10px`, `4px` |
| `--mdw-ui-input-padding-block`, `--mdw-ui-input-padding-inline` | `8px`, `10px` |
| `--mdw-ui-button-padding-block`, `--mdw-ui-button-padding-inline` | `6px`, `10px` |
| `--mdw-ui-control-radius`, `--mdw-ui-toolbar-control-size`, `--mdw-ui-icon-size` | `8px`, `36px` (`44px` under coarse pointers), `18px` |
| `--mdw-ui-table-edge-selector-size`, `--mdw-ui-table-edge-selector-overlap`, `--mdw-ui-table-edge-insertion-size` | `12px`, `1px`, `24px` |
| `--mdw-ui-table-edge-indicator-inset`, `--mdw-ui-table-edge-indicator-thickness` | `2px`, `2px` |
| `--mdw-ui-table-row-edge-indicator-max-size`, `--mdw-ui-table-column-edge-indicator-max-size` | `12px`, `18px` |
| `--mdw-ui-table-axis-action-size`, `--mdw-ui-table-axis-action-font-size`, `--mdw-ui-table-axis-action-icon-size` | `28px`, `12px`, `14px` |
| `--mdw-ui-table-edge-z-index` | `0` (keeps edge controls beneath host overlays) |
| `--mdw-ui-error-font-size`, `--mdw-ui-error-line-height` | `0.875rem`, `1.4` |

## Logical layout and ownership boundaries

Core owns presentation required to understand and operate document nodes: editable-canvas bounds, document rhythm, visible task controls, selected nodes/cells, passive and active code views, preserved-source atoms, and managed cursors. `markora-ui` owns only its dialogs, table toolbar, and table edge controls. The host owns all page-level layout, surrounding toolbars, product navigation, modal policy, global typography, portal stacking context, and theme placement.

The shipped styles use logical inline properties for document indentation, table alignment defaults, code gutters, toolbar grouping, and managed-block cursors. Runtime viewport coordinates remain physical because they describe browser geometry rather than reading order. Explicit Markdown table alignments named `left` and `right` remain content semantics and are not rewritten as `start`/`end`.

Overriding an accessibility floor, hiding a focus/selection indicator, or reducing contrast below the host's required standard is outside the supported reference presentation. Verify custom themes with keyboard focus, forced colors, browser zoom, both directions, and every portal/Shadow DOM mode used by the product.
