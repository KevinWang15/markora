# Performance budgets

This document defines the measurement contract established by `EE-013` and extended by `EE-014`. It covers Markora as an embedded editor component; it does not measure a standalone application or the React documentation site.

`performance/baseline.json` remains the immutable `packed-embedded-v1` historical record. `performance/ee014-hot-path.json` is the reviewed `packed-embedded-v2` candidate record, and `performance/budgets.json` is the current checked contract. Changing a limit or measurement semantic requires an explicit review of raw evidence, environment, variance, and user-facing impact.

## Compatibility decision

Runtime measurements use a small production-built, headless embedded consumer installed from a freshly packed `markora` tarball. It exercises the compatibility preset and core stylesheet without the optional `markora-ui` package. Measuring this consumer catches package-export, dependency-resolution, tree-shaking, CSS, and production-build behavior that a workspace import through the documentation application can hide. The benchmark records tarball and fixture provenance in its report.

Bundle reporting separately measures the compatibility entry with `markora-ui` and the `markora/minimal` entry graph, each installed from fresh tarballs, so shared chunks cannot make either graph appear artificially small. The totals include each checked consumer entry and its assertions as well as the installed package graph; the report hashes the harness so a measurement-instrumentation change cannot be mistaken for package drift. `pnpm pack:smoke` remains the structural package-isolation gate; the runtime report adds production latency and memory budgets rather than replacing it.

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
| Bundle size | bytes | Independently built compatibility and minimal static graphs, with production raw and compressed sizes plus async chunks |

Chromium memory evidence comes from the Chrome DevTools Protocol rather than `performance.memory`. Garbage collection is performed outside latency samples. One-time module and language-loading caches are warmed before the memory baseline so retained module code is not mislabeled as an editor leak. Firefox and WebKit timing can be recorded separately, but Chromium is the canonical CI memory environment.

The presentation boundary is a browser scheduling proxy, not a hardware paint or display-photon timestamp. Chromium Event Timing is retained as a diagnostic when the event exceeds its 16 ms reporting threshold. Its observer is given a bounded 100 ms post-measurement delivery window and explicitly drained without moving the saved presentation timestamp. A missing entry is recorded as censored only when the measured proxy is below the threshold; omission above the threshold invalidates the sample instead of being invented as zero. Future comparisons must keep the same boundary and must not relabel synchronous transaction time as keystroke-to-paint.

The v2 hot-path probe is a benchmark-only extension built exclusively through the public extension API. It handles trusted F8 input by dispatching `insertText("x")` in the keydown stack, making capture-to-document-bubble time an exact transaction-plus-callback boundary. Both candidate and control receive four leading edits, then measure the fifth. Candidate keys use absolute page-clock deadlines at 80 ms intervals and fail outside a 75–120 ms tolerance. Telemetry requires zero snapshots before every default dispatch, zero immediately after the measured dispatch, one latest `origin: user` callback after presentation, cache equality, exact character/byte growth, canonical reserialization, parsed-document equality, and no later callback during teardown. The candidate literally omits `onChangeMode`; the control explicitly selects `"immediate"`.

## Sampling and variance

The benchmark profile controls warmups and retained samples. The full local command uses three warmup rounds, 20 retained timing pairs, and seven retained memory samples per size. CI uses one warmup, five timing pairs, and three memory samples per size on a serial hosted runner. Every timing pair retains the unchanged historical page plus fresh immediate-control and omitted-default hot-path pages; candidate/control order alternates. Each CDP memory sample receives a fresh browser process and performs one throwaway editor lifecycle before its baseline. Both profiles write their effective counts, size order, scenario isolation/order, browser mode, and viewport into the result.

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

## Warning and failure policy

Each enforced metric has an explicit warning ceiling and failure ceiling. A value above the warning ceiling emits a visible CI annotation without failing the job. A value above the failure ceiling emits an error and makes `pnpm perf:ci` fail. Missing required samples, non-finite results, fixture drift, packed-consumer provenance failure, or an incompatible report schema are measurement failures rather than performance passes. Both drivers retain phase-attributed partial evidence for operational failures and replace workspace, home, and temporary paths with stable tokens before CI uploads it.

Budgets are fixed reviewed values in `performance/budgets.json`; the current run never rewrites or rebases them automatically. CI requires exactly one warmup, five timing pairs, three memory samples, every required document size, the pinned viewport/context/hot-path contract, and the declared isolation topology. Timing variability warns above a coefficient of variation of 0.25 and invalidates the run above 0.60. Historical latency, memory, and bundle ceilings are unchanged. V2 additionally gates maximum default synchronous processing, default presentation, and final snapshot latency at every size, plus maximum default/immediate ratio for 500 KiB and 1 MiB. Missing callbacks, invalid cadence, non-canonical output, final-state mismatch, or late delivery are hard measurement failures rather than budget leaves.

The approved record is:

| Field | Approved value |
| --- | --- |
| Baseline date and revision | 2026-07-17 candidate tree based on `234e6cb`; full raw evidence in `performance/baseline.json` |
| Hot-path candidate date and revision | 2026-07-17 candidate tree based on `17bb8d5`; full raw evidence in `performance/ee014-hot-path.json` |
| Local baseline browser/hardware | Chromium 149.0.7827.55; Apple M4 Max, 16 logical CPUs, 64 GiB, Darwin 25.5.0 arm64 |
| Canonical enforcement environment | `ubuntu-24.04`, Node.js 24.x, pnpm 10.6.5, Playwright 1.61.1 Chromium; actual versions and hardware recorded per artifact |
| Runtime latency ceilings | Explicit maximum warning/failure leaves for the six historical metrics plus default sync/presentation/snapshot and large-document paired ratio in `performance/budgets.json` |
| Memory ceilings | Explicit clean-teardown, tracked-memory, DOM-node, listener, and document leaves; retained listeners/documents must remain zero |
| Compatibility bundle baseline/candidate | 1,264,908/1,268,271 B initial JS, 570,072 B lazy JS, 15,503 B CSS, 154/156 static modules |
| Minimal bundle baseline/candidate | 678,165/681,464 B JS, 12,851 B CSS, no lazy chunks, 126/128 static modules |

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

Both commands write `performance-results/benchmark.json`. The directory is intentionally ignored because run evidence is environment-specific; CI uploads the JSON artifact. Reviewed historical and candidate records plus the active budgets are checked in separately through their focused iterations.

These package commands are the stable entry points around `scripts/performance-benchmark.mjs`; callers should not depend on its internal flags. The local entry selects the full baseline defaults, while the CI entry selects the CI profile and enables budget checking.

When investigating a regression, compare the raw series, variance, environment, fixture version, and tarball hashes before attributing a change to editor code. Reproduce on the same environment and profile before proposing a budget change.
