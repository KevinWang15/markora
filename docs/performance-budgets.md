# Performance budgets

`performance/budgets.json` is the checked performance contract. The benchmark
uses a production-built consumer installed from freshly packed workspace
tarballs, so package exports, dependency resolution, tree-shaking, CSS, and the
runtime path are measured as consumers receive them.

The runtime harness exercises only current behavior: the root editor, coalesced
idle `onChange` delivery, lazy CodeMirror activation, explicit snapshots, and
clean or dirty teardown. It uses exact 100 KiB, 500 KiB, and 1 MiB representative
Markdown documents and rejects external network requests or browser errors.

## Runtime contract

The checked CI profile uses:

- Chromium in a 1280 by 720 viewport with reduced motion;
- one warmup and five timing samples per document size;
- three fresh-browser memory samples per document size;
- a fresh page for each timing and hot-path scenario;
- a fresh browser process for each memory lifecycle;
- coalesced idle change delivery with a synchronous `flushChange()` boundary;
- nine visible code-block shells to verify the eight-editor activation cap.

Timing budgets cover initial synchronous parse/render, presentation, standalone
codec parse and serialization, trusted-key presentation, snapshot latency, and
dirty teardown. Memory budgets cover tracked heap growth, mounted CodeMirror
instances, DOM nodes, event listeners, documents, and retained resources after
teardown. Warning and failure ceilings are defined per document size.

## Bundle contract

Bundle reporting builds the full root graph with `markora-ui` and the
`markora/minimal` graph independently from packed packages. The root static
closure must exclude CodeMirror, Lezer, and the active code editor while keeping
them in lazy chunks. The minimal graph must exclude those modules, table editing,
and root-only styles from every chunk.

Raw and gzip JavaScript, CSS, lazy output, total output, and static module counts
are checked against `performance/budgets.json`. Optional advanced-syntax packages
are also packed and measured without bundling host renderer engines.

The 2026-08-31 root-bundle review measured 41,949 raw / 6,221 gzip CSS bytes
and 181 static modules after the theme, localization, and table-control work.
The review also replaced the `@lucide/icons` barrel import, which made the
consumer traverse 1,958 static modules, with the package's per-icon entry
points. The root failure ceilings retain approximately 5–7% headroom over the
reviewed 181-module / 41,949-byte graph; the older warning thresholds remain in
place so further growth stays visible in CI.

The context-menu bundle review ([packed report from CI](https://github.com/KevinWang15/markora/actions/runs/34149295604))
measured the following production-minified consumer at `1817089`:

| Full editor + default UI | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Initial JavaScript | 1,024,466 | 280,195 |
| Lazy JavaScript | 1,086,850 | 345,467 |
| Total JavaScript | 2,111,316 | 625,662 |
| CSS | 44,903 | 6,694 |

The graph has 187 static modules. Context-menu composition, targeting,
clipboard transport, accessible interaction, and the extracted overlay environment
add six modules to the reviewed 181-module default-UI graph. This is an
intentional feature cost in the optional UI consumer; it does not move default
UI or active CodeMirror into the headless/minimal entry. The new root initial,
total, and CSS failure ceilings retain approximately 5–7% headroom over these
measurements. Warning thresholds, lazy-chunk ceilings, static-module ceilings,
minimal-editor limits, and all runtime/memory contracts remain unchanged.

## Commands

Run the same checked entry point used by CI:

```sh
pnpm perf:ci
```

For a local report without enforcing CI sample counts and ceilings:

```sh
pnpm perf:benchmark --profile quick
```

Reports are written under the ignored `performance-results/` directory and
include environment, fixture, package, tarball, and harness provenance. Review
raw samples and variance before changing a budget.
