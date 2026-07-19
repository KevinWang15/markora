# Performance budgets

This document defines the measurement contract established by `EE-013` and extended by `EE-014`, `EE-015`, `EE-018`, `EE-019`, and `EE-021`. It covers Markora as an embedded editor component; it does not measure a standalone application or the React documentation site.

`performance/baseline.json` remains the immutable `packed-embedded-v1` historical record. `performance/ee014-hot-path.json` and `performance/ee015-lazy-code-blocks.json` are the reviewed `packed-embedded-v2` and `packed-embedded-v3` candidate records, and `performance/budgets.json` is the current checked contract. Changing a limit or measurement semantic requires an explicit review of raw evidence, environment, variance, and user-facing impact.

## Compatibility decision

Runtime measurements use a small production-built, headless embedded consumer installed from a freshly packed `markora` tarball. It exercises the compatibility preset and core stylesheet without the optional `markora-ui` package. Measuring this consumer catches package-export, dependency-resolution, tree-shaking, CSS, and production-build behavior that a workspace import through the documentation application can hide. The benchmark records tarball and fixture provenance in its report.

Bundle reporting separately measures the compatibility entry with `markora-ui` and the `markora/minimal` entry graph, each installed from fresh tarballs, so shared chunks cannot make either graph appear artificially small. The compatibility graph must exclude CodeMirror, Lezer, and the active code-block adapter from its complete static import closure while retaining them in lazy chunks. The minimal graph must exclude them from every emitted chunk and imports `markora/minimal.css`, which omits compatibility-only table, task, opaque-source, and code-editor presentation rules. `EE-018` additionally requires the minimal graph to exclude `prosemirror-tables` and Markora's table-editing and table-fidelity runtime bridges while retaining the shared typed command facade. The totals include each checked consumer entry and its assertions as well as the installed package graph; the report hashes the harness so a measurement-instrumentation change cannot be mistaken for package drift. `pnpm pack:smoke` remains the structural package-isolation gate; the runtime report adds production latency and memory budgets rather than replacing it.

Optional `EE-021` packages are also installed from their tarballs and measured as independent feature-only graphs. Their package-local leaves cannot move the root or minimal baseline budgets, and executable isolation assertions require the optional code and styles to remain absent from both baseline graphs.

`EE-013` did not change the editor API, Markdown compatibility contract, resource security policy, DOM semantics, or accessibility behavior. It fixed one teardown leak found by the benchmark: ImageView now owns and cancels its infinite loading-spinner animation when loading ends or the view is destroyed. `EE-014` intentionally changes the omitted `onChangeMode` from same-stack delivery to coalesced idle delivery while retaining explicit `"immediate"` and `"animationFrame"` modes. Parse/serialize output, update-event semantics, synchronous snapshots, resource policy, and DOM/accessibility behavior remain unchanged.

## Representative documents

The driver generates the same ASCII, LF-only mixed-content Markdown on every run. The checked generator version and exact byte targets are part of the report:

| Workload | Exact UTF-8 bytes | Representative content |
| --- | ---: | --- |
| 100 KB | 102,400 | Repeated prose and inline marks, four-level nested lists, tables, fenced code blocks, and images |
| 500 KB | 512,000 | The same section mix at approximately five times the scale |
| 1 MB | 1,048,576 | The same section mix at approximately ten times the scale |

Generation fails if a fixture is not the requested byte length or does not contain a mixed-content section. The report retains the generator version and structural counts for code blocks, tables, images, nested lists, and sections. Remote image fetching is not part of the latency workload; resource behavior has separate browser and CDP coverage.

## Metric semantics

All latency is measured with the browser's monotonic clock. Package preparation, page navigation, fixture generation, Playwright transport, and report writing stay outside timed regions.

| Metric | Unit | Timed region |
| --- | --- | --- |
| Initial parse/render | milliseconds | Immediately before `createEditor()` through synchronous parse, canonicalization, state creation, node-view construction, and DOM insertion; a second value extends that start through the next presentation opportunity |
| Historical keydown-to-presentation proxy | milliseconds | The unchanged `EE-013` trusted lowercase-key scenario, mounted with explicit `onChangeMode: "immediate"`, through one `origin: user` document update and the next animation-frame/task presentation opportunity |
| Paired synchronous processing | milliseconds/ratio | A trusted benchmark F8 key captured before a public extension dispatches one ordinary user transaction through document-bubble completion; explicit-immediate and omitted-default editors both measure the fifth edit after four leading edits on fresh pages |
| Default-idle presentation | milliseconds | The measured fifth trusted F8 key through the next presentation opportunity while the shipped default keeps Markdown serialization out of that input task |
| Default-idle snapshot latency | milliseconds | The measured fifth trusted F8 key through exactly one delayed, canonical Markdown callback after the trailing quiet period; savings and default/immediate ratio are retained per pair |
| Parse and serialization | milliseconds | Direct `codec.parse(fixture)` and `codec.serialize(parsedDocument)` calls through a public instrumentation extension; this bypasses `getMarkdown()` identity caching without private package imports |
| Teardown | milliseconds | A dirty editor's synchronous `destroy()` and required cleanup; post-destroy DOM settlement is reported separately when available |
| Mounted memory | bytes/counts | Garbage-collected Chromium JavaScript, embedder-heap, backing-storage, DOM-node, document, and listener deltas from a warmed packed-page baseline to a settled editor |
| Retained memory | bytes/counts | The same counters after destroy relative to the warmed baseline; tracked memory is the reported sum of JavaScript, embedder-heap, and backing-storage deltas |
| Code-block activation | counts and DOM evidence | Settled shell states and live `.cm-editor` instances while the first, middle, and last fences are selected in turn; active editors must remain within the fixed pool cap |
| Bundle size | bytes | Independently built compatibility and minimal static graphs, with production raw and compressed sizes plus async chunks |

Chromium memory evidence comes from the Chrome DevTools Protocol rather than `performance.memory`. Garbage collection is performed outside latency samples. One-time module and language-loading caches are warmed before the memory baseline so retained module code is not mislabeled as an editor leak. Firefox and WebKit timing can be recorded separately, but Chromium is the canonical CI memory environment.

The presentation boundary is a browser scheduling proxy, not a hardware paint or display-photon timestamp. Chromium Event Timing is retained as a diagnostic when the event exceeds its 16 ms reporting threshold. Its observer is given a bounded 100 ms post-measurement delivery window and explicitly drained without moving the saved presentation timestamp. A missing entry is recorded as censored only when the measured proxy is below the threshold; omission above the threshold invalidates the sample instead of being invented as zero. Future comparisons must keep the same boundary and must not relabel synchronous transaction time as keystroke-to-paint.

The v2 hot-path probe is a benchmark-only extension built exclusively through the public extension API. It handles trusted F8 input by dispatching `insertText("x")` in the keydown stack, making capture-to-document-bubble time an exact transaction-plus-callback boundary. Both candidate and control receive four leading edits, then measure the fifth. Candidate keys use absolute page-clock deadlines at 80 ms intervals and fail outside a 75–120 ms tolerance. Telemetry requires zero snapshots before every default dispatch, zero immediately after the measured dispatch, one latest `origin: user` callback after presentation, cache equality, exact character/byte growth, canonical reserialization, parsed-document equality, and no later callback during teardown. The candidate literally omits `onChangeMode`; the control explicitly selects `"immediate"`.

## Sampling and variance

The benchmark profile controls warmups and retained samples. The full local command uses three warmup rounds, 20 retained timing pairs, and seven retained memory samples per size. CI uses one warmup, five timing pairs, and three memory samples per size on a serial hosted runner. Every timing pair retains the unchanged historical page plus fresh immediate-control and omitted-default hot-path pages; candidate/control order alternates. Each CDP memory sample receives a fresh browser process and performs one throwaway editor lifecycle before its baseline. The warm and measured lifecycles scroll to and select the first, middle, and last code blocks. The report retains viewport-only state as diagnostic evidence, requires every authoritative selection to produce a live editor, and gates both the observed peak and final live-editor count at eight. Every shell must have exactly one `inactive`, `loading`, `active`, or `error` state; passive and active containers remain countable; settled loading and error counts must be zero. Both profiles write their effective counts, size order, scenario isolation/order, browser mode, and viewport into the result.

Warmups are excluded from summaries. Measured document sizes are rotated rather than always running from smallest to largest. Samples are not silently trimmed. For every primary latency and memory series the report retains raw values and records count, minimum, maximum, mean, median, nearest-rank p90 and p95, standard deviation, coefficient of variation, and median absolute deviation; Event Timing remains per-sample diagnostic metadata.

A noisy result is evidence about the run, not permission to discard inconvenient observations. Budget review must inspect both p95 and variance. The 20-sample baseline reports a meaningful nearest-rank p95; the five-sample CI profile explicitly gates on `maximum` rather than describing its maximum as p95. Memory leaves state whether they gate on maximum or median.

## Environment and provenance

`performance-results/benchmark.json` is the authoritative machine-readable result for an ordinary run. Reviewed records may additionally be promoted to the checked-in `performance/` directory. A report must identify enough context to distinguish a product regression from an environment change:

- Git revision and dirty-worktree state
- Operating system, release, architecture, CPU model, logical cores, and total memory
- Node.js, pnpm, Playwright, and browser versions
- Browser user agent, headless mode, viewport, device-pixel ratio, and hardware concurrency
- Benchmark profile, generator version, exact fixture sizes, and structural counts
- Packed package versions, tarball hashes, and resolved packed entry points
- Raw samples, summary statistics, budget evaluations, and unsupported metrics

The canonical CI environment is the serial `ubuntu-24.04`, Node.js 24, pinned-pnpm and pinned-Playwright Chromium job in `.github/workflows/performance.yml`. Local results remain useful, but their hardware and browser identity must accompany any comparison with CI.

## Historical approved EE-013 baseline

The initial approved evidence is `performance/baseline.json`, captured on 2026-07-17 from the candidate EE-013 tree based on revision `234e6cb`. It used an Apple M4 Max with 16 logical CPUs and 64 GiB RAM, macOS/Darwin 25.5.0 arm64, Node.js 25.6.0, pnpm 10.6.5, Playwright 1.61.1, and headless Chromium 149.0.7827.55. The report records the dirty candidate-tree state, packed tarball hash, stable packed module provenance, fixture hashes, browser details, raw samples, and SHA-256 hashes for every harness input.

These rounded values summarize the full 3-warmup, 20-timing, 7-memory local run. Latencies are p95; mounted tracked memory is the median; retained tracked memory is the maximum.

| Exact bytes | Sync mount | Mount to presentation | Codec parse | Codec serialize | Keydown proxy | Dirty teardown | Mounted tracked memory | Retained tracked memory |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 102,400 | 56.2 ms | 103.6 ms | 8.1 ms | 4.6 ms | 13.8 ms | 14.2 ms | 11.7 MB | 0.45 MB |
| 512,000 | 235.1 ms | 399.5 ms | 37.7 ms | 112.6 ms | 139.6 ms | 158.0 ms | 57.9 MB | 0.20 MB |
| 1,048,576 | 633.6 ms | 934.2 ms | 88.6 ms | 408.4 ms | 477.0 ms | 501.5 ms | 116.8 MB | 0.17 MB |

All 21 measured teardown lifecycles retained zero DOM nodes, event listeners, and documents after garbage collection. The benchmark initially exposed an ImageView spinner-animation leak of roughly 6,200 detached nodes per 100 KiB lifecycle; the product fix and the zero-retention baseline are part of this item.

This macOS result approves the first regression ceilings but is not presented as an Ubuntu measurement. The workflow runner is the canonical enforcement environment, records its actual Node/browser/hardware details on every run, and uploads both runtime and bundle JSON. The thresholds include reviewed Linux-runner headroom; the first CI artifact becomes the canonical cross-environment comparison without rewriting the approved limits.

## Approved EE-014 hot-path candidate

`performance/ee014-hot-path.json` is the full local v2 evidence captured on 2026-07-17 from the candidate tree based on revision `17bb8d5`. It uses the same Apple M4 Max, macOS, Node.js, pnpm, Playwright, and Chromium environment as the historical baseline and retains three warmup rounds, 20 paired timing samples, and seven isolated memory samples per size. The report records the dirty candidate tree, packed tarball and module provenance, fixture/harness hashes, raw samples, scenario evidence, and variance.

The values below are p95 across the 20 retained pairs. Ratio is the p95 of the per-pair default/immediate ratio, not a quotient of separately summarized values.

| Exact bytes | Immediate sync | Default sync | Default presentation | Final snapshot | Sync savings | Default/immediate ratio |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 102,400 | 5.4 ms | 3.0 ms | 4.4 ms | 312.5 ms | 2.7 ms | 0.659 |
| 512,000 | 121.4 ms | 9.7 ms | 14.0 ms | 440.1 ms | 113.4 ms | 0.090 |
| 1,048,576 | 460.1 ms | 21.1 ms | 29.8 ms | 738.2 ms | 440.6 ms | 0.050 |

The large-document result is the architectural acceptance signal: at 500 KiB the default input task is at most 9% of its paired immediate control at p95, and at 1 MiB it is at most 5%. The 100 KiB ratio is retained but not gated because fixed transaction/instrumentation cost dominates a serializer that is already only a few milliseconds. The unchanged historical keydown proxy remains stable at 13.9, 142.4, and 472.6 ms p95 for 100 KiB, 500 KiB, and 1 MiB respectively, so the new proof does not relabel or erase the original regression series.

All 21 candidate memory lifecycles again retain zero DOM nodes, event listeners, and documents. The two small internal scheduler/validation modules move the separately built compatibility graph to 1,268,271 B initial plus 570,072 B lazy JavaScript and 156 static modules, and the minimal graph to 681,464 B and 128 modules. Byte limits pass below warning; the reviewed module-count warning bands fire without crossing their failure ceilings. Those warnings are accepted for this iteration and remain visible for `EE-015` bundle work.

## Approved EE-015 lazy-activation candidate

The `packed-embedded-v3` harness treats initial and lazy JavaScript as separate architectural budgets. The root static closure is invalid if it contains the active code-block adapter or any CodeMirror or Lezer module; the emitted lazy closure is invalid if it omits the adapter, CodeMirror state/view/commands/language, or the shared Lezer runtime. The overall root failure ceilings remain 1,900,000 raw and 570,000 gzip bytes, so moving work behind activation cannot hide total growth. The minimal consumer remains a single static graph with no CodeMirror or Lezer modules and now uses its dedicated stripped stylesheet.

`performance/ee015-lazy-code-blocks.json` is the full local v3 evidence captured on 2026-07-17 from the candidate tree based on revision `5037562`. It uses the same Apple M4 Max, macOS, Node.js, pnpm, Playwright, and Chromium environment as the earlier records and retains three warmup rounds, 20 paired timing samples, and seven fresh-process memory samples per size. The runtime probe records exact shell and activation evidence in addition to CDP totals: every memory lifecycle pressures nine shells, observes an exact peak and settled count of eight live editors, and settles with no loading or error shells.

The values below summarize the seven isolated memory samples per size. Mounted tracked memory is the median; retained tracked memory, mounted nodes, and mounted listeners are maxima.

| Exact bytes | Mounted tracked memory | Retained tracked memory | Mounted nodes | Mounted listeners | Peak/final editors | Retained nodes/listeners/documents |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 102,400 | 11.83 MB | 0.64 MB | 7,825 | 327 | 8 / 8 | 0 / 0 / 0 |
| 512,000 | 51.55 MB | 0.26 MB | 34,425 | 327 | 8 / 8 | 0 / 0 / 0 |
| 1,048,576 | 103.97 MB | 0.24 MB | 69,005 | 327 | 8 / 8 | 0 / 0 / 0 |

Compared with the approved v2 candidate on the same machine, passive shells reduce p95 initial mount-to-presentation from 106.0/393.3/931.7 ms to 85.2/342.2/845.6 ms across the three sizes. Maximum mounted nodes fall from 8,985/45,945/93,993 to 7,825/34,425/69,005, while mounted listeners become document-size independent at 327 instead of rising to 5,187. All 21 teardown lifecycles again retain zero DOM nodes, listeners, and documents.

The separately built compatibility graph is 808,108 B initial plus 1,078,728 B lazy JavaScript, with 146 static modules; its static closure excludes the active adapter, CodeMirror, and Lezer. The complete graph is 1,886,836 B raw and 561,474 B gzip. The independently built minimal graph is 681,873 B, 128 modules, and has no lazy chunks or CodeMirror/Lezer modules; `minimal.css` is 4,728 B raw. Total compatibility raw/gzip JavaScript and raw CSS are above their warning ceilings but remain below the reviewed failure ceilings, so those accepted warnings stay visible rather than being rebased away.

## Approved EE-018 table-editing candidate

`EE-018` introduces a root-only rectangular cell-selection and table-editing runtime, table-fidelity diagnostics, and the optional creation/resize toolbar UI. The packed compatibility graph is 886,734 B raw / 243,163 B gzip initial JavaScript, 1,079,002 B / 338,835 B lazy JavaScript, 1,965,736 B / 581,998 B total JavaScript, 18,479 B / 3,474 B CSS, and 151 static modules. Against the completed `EE-017` graph, that is +66,141 B / +17,306 B initial JavaScript, +66,141 B / +17,306 B total JavaScript, +1,652 B / +214 B CSS, and three static modules; the lazy graph is otherwise unchanged.

The independently built minimal graph remains a single static chunk and measures 700,726 B raw / 197,151 B gzip JavaScript, 4,728 B / 1,218 B CSS, and 129 modules. Its shared public-command contract accounts for +10,057 B / +2,408 B JavaScript relative to `EE-017`, but the package graph contains no `prosemirror-tables`, `tableEditing`, or `tableFidelity` runtime. Those exclusions are executable packed-consumer assertions, not source-layout assumptions.

Only the six root byte failure ceilings crossed by the reviewed feature were revised: initial JavaScript to 900,000 B raw / 250,000 B gzip, total JavaScript to 1,980,000 B / 590,000 B, and CSS to 18,750 B / 3,550 B. All warning thresholds, lazy thresholds, module-count thresholds, and minimal-entry thresholds remain unchanged. The accepted root and minimal growth therefore stays visible as warnings, while another root module or a small unreviewed minimal increase still fails the gate.

## Approved EE-019 typing-ergonomics candidate

`EE-019` adds opt-in typing provenance, configurable shortcut policy, safe code-fence serialization, and the optional exact fence-info editor. The packed compatibility graph is 918,441 B raw / 250,699 B gzip initial JavaScript, 1,084,626 B / 340,391 B lazy JavaScript, 2,003,067 B / 591,090 B total JavaScript, 19,261 B / 3,568 B CSS, and 154 static modules. Against `EE-018`, that is +31,707 B / +7,536 B initial JavaScript, +5,624 B / +1,556 B lazy JavaScript, +37,331 B / +9,092 B total JavaScript, +782 B / +94 B CSS, and three static modules.

The independently built minimal graph remains one static chunk at 722,201 B raw / 202,812 B gzip JavaScript, 4,728 B / 1,218 B CSS, and 132 modules. Its +21,475 B / +5,661 B JavaScript and three-module increase is the deliberate synchronous cost of `typingErgonomics`, `shortcutConfig`, and `codeBlockMarkdown`. The packed graph contains no `markora-ui`, active CodeMirror adapter, CodeMirror, or Lezer module.

Only crossed failure ceilings were revised: root initial JavaScript to 930,000 B / 255,000 B, root total JavaScript to 2,020,000 B / 600,000 B, root CSS to 19,500 B / 3,650 B, root static modules to 154, minimal initial and total JavaScript to 730,000 B / 205,000 B, and minimal static modules to 132. Every warning threshold and every passing lazy-JavaScript and minimal-CSS ceiling remains unchanged, so all accepted growth remains visible.

## Approved EE-021 sanitized-HTML feature graph

`markora-extension-html` is an optional compatibility-root-only package that requires extension API `^1.3.0`; minimal and incompatible custom runtimes reject it before host claim. Its independently packed feature graph is one 258,459 B raw / 81,858 B gzip JavaScript chunk with zero lazy chunks, one 4,863 B / 1,227 B gzip CSS file, and 99 statically traversed modules.

The installed graph contains no renderer engine or sibling optional extension and remains absent from both baseline root and minimal graphs. `pnpm pack:smoke` verifies tarball provenance, files, exports, styles, public type and Node ESM consumption, exact-source root runtime behavior, update and undo, safe host rendering, intentional minimal preclaim rejection, and the bundle/isolation contract. These package-local measurements do not change any root or minimal budget.

A retained 512-atom source-only workload covers exact parse/serialization, identity-preserving ordinary typing, reconciliation, hard reset, teardown, and the absence of synchronous renderer calls. Separate renderer-pressure tests enforce viewport gating, four-job concurrency, output bounds, cancellation, and stale-result cleanup.

The HTML warning ceilings are 270,000 B raw / 85,500 B gzip JavaScript, 5,000 B / 1,300 B gzip CSS, and 105 modules; failure ceilings are 282,000 B / 89,600 B JavaScript, 5,225 B / 1,350 B CSS, and 110 modules. The measured graph is below every warning ceiling, zero lazy chunks is mandatory, and the failure leaves retain approximately 10% headroom.

## Approved EE-021 diagrams and all-seven integration

`markora-extension-diagrams` is independently packed and measured from its
installed tarball. Its feature graph is one 140,346 B raw / 36,197 B gzip
JavaScript chunk with no lazy chunks, one 3,698 B / 1,004 B gzip CSS file, and
99 static modules. The graph contains no renderer engine or sibling extension
and remains absent from the root and minimal baselines. Raw and gzip JavaScript
cross their deliberately tight 135,000 B / 35,000 B warning ceilings but remain
below the reviewed 145,000 B / 37,500 B failure ceilings; all CSS, lazy, and
module warning leaves pass.

The final installed all-seven root consumer measures 1,176,840 B / 315,639 B
gzip initial JavaScript, 1,088,605 B / 340,993 B gzip lazy JavaScript,
2,265,445 B / 656,632 B gzip total JavaScript, 54,546 B / 7,612 B gzip CSS,
and 202 static modules. Every all-seven warning ceiling passes. Executable
isolation checks require one deterministic definition from each optional
package, all seven explicit styles, no renderer/YAML engine, no workspace-source
fallback, and no optional package in either baseline graph.

The `packed-all-seven-v2` runtime harness builds exact 102,400, 512,000, and
1,048,576-byte documents containing every feature and all four diagram kinds.
It runs one warmup plus five fresh-page timing samples per size, then three
fresh-Chromium-process memory lifecycles per size. The values below are the
maximum of the five timing samples from the approved 2026-07-19 local run.

| Exact bytes | Mount | Ordinary edit | Structural footnote | TOC heading | Diagram removal | Destroy |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 102,400 | 107.7 ms | 5.2 ms | 7.1 ms | 2.1 ms | 6.7 ms | 3.8 ms |
| 512,000 | 756.0 ms | 27.3 ms | 50.5 ms | 23.3 ms | 41.9 ms | 15.8 ms |
| 1,048,576 | 1,312.4 ms | 46.6 ms | 80.4 ms | 43.1 ms | 71.1 ms | 20.8 ms |

Mounted tracked memory is the median of three samples; retained tracked memory,
mounted nodes, and mounted listeners are maxima. All nine lifecycles retain
zero nodes, listeners, and documents.

| Exact bytes | Mounted tracked memory | Retained tracked memory | Mounted nodes | Mounted listeners | Retained nodes/listeners/documents |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 102,400 | 11.09 MB | 192,073 B | 9,204 | 563 | 0 / 0 / 0 |
| 512,000 | 52.79 MB | 203,889 B | 46,500 | 2,705 | 0 / 0 / 0 |
| 1,048,576 | 107.01 MB | 242,117 B | 95,044 | 5,493 | 0 / 0 / 0 |

The approved run keeps its advisory timing and variability warnings visible;
every hard runtime, memory, cleanup, and functional gate passes.

Functional evidence is a hard gate rather than a timing budget: ordinary edits
must retain footnote and TOC identities with zero renderer calls; structural
footnote and heading edits must update their indexes; the specifically last
offscreen diagram must activate only after scrolling; eight pressured renders
must observe a four-job maximum, seven successes, and one bounded-output error;
and removal, reset, failed creation, and destroy must leave no observer, signal,
promise, callback, preview, error, or late renderer work.

## Warning and failure policy

Each enforced metric has an explicit warning ceiling and failure ceiling. A value above the warning ceiling emits a visible CI annotation without failing the job. A value above the failure ceiling emits an error and makes `pnpm perf:ci` fail. Missing required samples, non-finite results, fixture drift, packed-consumer provenance failure, or an incompatible report schema are measurement failures rather than performance passes. Both drivers retain phase-attributed partial evidence for operational failures and replace workspace, home, and temporary paths with stable tokens before CI uploads it.

Budgets are fixed reviewed values in `performance/budgets.json`; the current run never rewrites or rebases them automatically. CI requires exactly one warmup, five timing pairs, three memory samples, every required document size, the pinned viewport/context/hot-path contract, and the declared isolation topology. Timing variability warns above a coefficient of variation of 0.25 and invalidates the run above 0.60. Historical latency ceilings remain unchanged. V2 additionally gates maximum default synchronous processing, default presentation, and final snapshot latency at every size, plus maximum default/immediate ratio for 500 KiB and 1 MiB. V3 rebases the initial/lazy bundle partition, tightens mounted memory/node/listener ceilings, and gates active-editor peak/final counts at eight. `EE-018` revises only its measured root byte failure ceilings; `EE-019` revises only its crossed root/minimal byte and module-count failure ceilings. `EE-021` adds isolated sanitized-HTML, diagram, and all-seven feature-graph leaves plus the packed all-seven runtime contract without changing any root or minimal ceiling. The older warnings and every passing lazy/minimal-CSS ceiling continue to expose the cost. Missing callbacks, invalid cadence, non-canonical output, final-state mismatch, invalid code-block state partitions, activation failures, or late delivery are hard measurement failures rather than budget leaves.

The approved record is:

| Field | Approved value |
| --- | --- |
| Baseline date and revision | 2026-07-17 candidate tree based on `234e6cb`; full raw evidence in `performance/baseline.json` |
| Hot-path candidate date and revision | 2026-07-17 candidate tree based on `17bb8d5`; full raw evidence in `performance/ee014-hot-path.json` |
| Lazy-activation candidate date and revision | 2026-07-17 candidate tree based on `5037562`; full raw evidence in `performance/ee015-lazy-code-blocks.json` |
| Table-editing candidate date and revision | 2026-07-17 candidate tree based on `ff6feea`; packed and runtime evidence generated by the versioned v3 harness |
| Local baseline browser/hardware | Chromium 149.0.7827.55; Apple M4 Max, 16 logical CPUs, 64 GiB, Darwin 25.5.0 arm64 |
| Canonical enforcement environment | `ubuntu-24.04`, Node.js 24.x, pnpm 10.6.5, Playwright 1.61.1 Chromium; actual versions and hardware recorded per artifact |
| Runtime latency ceilings | Explicit maximum warning/failure leaves for the six historical metrics plus default sync/presentation/snapshot and large-document paired ratio in `performance/budgets.json` |
| Memory ceilings | Explicit clean-teardown, tracked-memory, DOM-node, listener, and document leaves; retained listeners/documents must remain zero |
| EE-013/014 compatibility bundle history | 1,264,908/1,268,271 B initial JS, 570,072 B lazy JS, 15,503 B CSS, 154/156 static modules |
| EE-013/014 minimal bundle history | 678,165/681,464 B JS, 12,851 B CSS, no lazy chunks, 126/128 static modules |
| EE-015 compatibility candidate | 808,108 B initial plus 1,078,728 B lazy JS; 1,886,836 B total; 16,881 B CSS; 146 static modules |
| EE-015 minimal candidate | 681,873 B JS; 4,728 B CSS; no lazy chunks; 128 static modules |
| EE-018 compatibility candidate | 886,734 B / 243,163 B gzip initial JS; 1,965,736 B / 581,998 B gzip total JS; 18,479 B / 3,474 B gzip CSS; 151 static modules |
| EE-018 minimal candidate | 700,726 B / 197,151 B gzip JS; 4,728 B / 1,218 B gzip CSS; no lazy chunks; 129 static modules; no table-editing runtime |
| EE-021 sanitized-HTML feature graph | 258,459 B / 81,858 B gzip JS; no lazy chunks; 4,863 B / 1,227 B gzip CSS; 99 static modules; root-only, with no renderer engine or sibling extension |
| EE-021 diagram feature graph | 140,346 B / 36,197 B gzip JS; no lazy chunks; 3,698 B / 1,004 B gzip CSS; 99 static modules; no renderer engine or sibling extension |
| EE-021 all-seven consumer | 1,176,840 B / 315,639 B gzip initial JS; 1,088,605 B / 340,993 B gzip lazy JS; 2,265,445 B / 656,632 B gzip total JS; 54,546 B / 7,612 B gzip CSS; 202 modules |
| Current compatibility failure ceilings | 945,000 B / 257,000 B gzip initial JS; 1,120,000 B / 355,000 B gzip lazy JS; 2,040,000 B / 600,000 B gzip total JS; 37,000 B / 5,600 B gzip CSS; 158 static modules |
| EE-015 code-block pool | At most eight settled active editors; every shell in exactly one declared state; no settled loading or error shells |

## Reproduction

Install the locked workspace dependencies and Chromium once:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Run the full local benchmark profile:

```sh
pnpm perf:benchmark
```

Run the same CI entry point that evaluates warning and failure budgets:

```sh
pnpm perf:ci
```

`pnpm perf:benchmark` writes `performance-results/benchmark.json`. The CI entry
also writes the packed `bundle.json` report and the all-seven
`advanced-syntax.json` report. The directory is intentionally ignored because
run evidence is environment-specific; CI uploads the JSON artifacts. Reviewed
historical and candidate records plus the active budgets are checked in
separately through their focused iterations.

These package commands are the stable entry points around the legacy and
all-seven harnesses; callers should not depend on their internal flags. The
local entry selects the full baseline defaults, while the CI entry packs the
candidate, runs both runtime contracts, and enables every budget check.

When investigating a regression, compare the raw series, variance, environment, fixture version, and tarball hashes before attributing a change to editor code. Reproduce on the same environment and profile before proposing a budget change.
