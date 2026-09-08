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

The idle hot-path probe schedules each trusted key 80 ms after the previous
key's actual page timestamp. This avoids catch-up intervals after a delayed
browser dispatch. Every observed interval must still fall within 75–120 ms;
late input, premature snapshots, and budget overruns continue to fail the run.
Reports record each adjusted target and its dispatch lateness.

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

## Runtime consolidation and buffered serialization review

The shared-runtime refactor extracts nine additional root modules and eight
minimal modules without adding third-party dependencies. The reviewed graphs
contain 196 and 148 static modules. Their failure ceilings move by exactly those
extraction deltas (190 → 199 and 142 → 150). All JavaScript/CSS byte failure
ceilings and dependency-exclusion invariants remain unchanged.

The measured full editor/default UI initial output is 1,026,935 raw / 281,396 gzip
bytes; minimal is 794,333 raw / 222,605 gzip bytes. Root CSS remains 44,903 raw /
6,694 gzip; minimal CSS remains 11,639 raw / 2,411 gzip. Root/minimal warning
thresholds now reflect these reviewed baselines, with smaller headroom than the
failure ceilings, instead of warning continuously against obsolete feature sets.

CPU profiling of the representative 1 MiB document on the local Xeon E5-2650 v4,
Node 24.18 host identified repeated output-string flattening in the serializer's
line-ending checks. A chunked writer retains a two-character suffix and preserves
ProseMirror's output semantics, including custom serializer reads/writes. In the
focused CPU-profiled diagnostic, five warmed serializations changed from
3,885–3,966 ms to 159–226 ms. This is a codec measurement, not an end-to-end browser
latency claim. `pnpm perf:serialization` records fixture sizes, samples, environment
and output hashes; the packed Chromium benchmarks validate product behavior.

The Chromium report at `80d064b` measured a 1 MiB serialization maximum of 115.195 ms,
mounting maximum of 556.86 ms, and idle snapshot latency maximum of 425.73 ms. All
memory checks passed. That run failed one parse sample (329.025 ms against 280 ms;
the other four were 173.67–191.165 ms). Follow-up normalization now reuses immutable
nodes and avoids rebuilding unchanged task-list/whitespace subtrees and attributes.
The parse ceiling is unchanged. To protect the serialization improvement, the
512 KiB and 1 MiB serialization failure ceilings are reduced to 250 and 500 ms,
and the 1 MiB idle snapshot ceiling to 1,000 ms.

## In-place math editing review

The math extension now includes the native TeX input, syntax mirror, focus styling,
responsive sizing and forced-colors fallback formerly supplied by a host dialog.
The packed stylesheet measures 8,158 raw / 1,858 gzip bytes. Its CSS warning/failure
ceilings become 8,500/9,200 raw and 1,950/2,100 gzip bytes, retaining approximately
12–13% failure headroom for this new feature. This changes only the standalone
math CSS allowance. JavaScript, combined-extension CSS, dependency exclusions,
and runtime/memory failure ceilings remain unchanged. No CodeMirror, React or
rendering-engine dependency was added to math's source editor.

## Parser allocation review

CPU profiling after the interaction audit found avoidable allocation in ordinary
Markdown parsing. Opaque inline source hydration now skips paragraphs without
opaque tokens and uses direct offsets for LF-only source; CR and CRLF still use
an exact offset map. The source-fidelity tests cover repeated inline spans and
Unicode prefixes with all three line-ending forms. Task normalization stops at
text blocks, and whitespace normalization analyzes crossing mark runs only when
marked text actually has whitespace at an edge. The checked fixtures and all
runtime, memory and bundle budgets remain unchanged.
