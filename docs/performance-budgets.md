# Performance budgets

This document defines the measurement contract for `EE-013`. It covers Markora as an embedded editor component; it does not measure a standalone application or the React documentation site.

The checked baseline and warning/failure limits are the approved `EE-013` regression contract. Changing them requires an explicit review of raw evidence, environment, variance, and user-facing impact.

## Compatibility decision

Runtime measurements use a small production-built, headless embedded consumer installed from a freshly packed `markora` tarball. It exercises the compatibility preset and core stylesheet without the optional `markora-ui` package. Measuring this consumer catches package-export, dependency-resolution, tree-shaking, CSS, and production-build behavior that a workspace import through the documentation application can hide. The benchmark records tarball and fixture provenance in its report.

Bundle reporting separately measures the compatibility entry with `markora-ui` and the `markora/minimal` entry graph, each installed from fresh tarballs, so shared chunks cannot make either graph appear artificially small. The totals include each checked consumer entry and its assertions as well as the installed package graph; the report hashes the harness so a measurement-instrumentation change cannot be mistaken for package drift. `pnpm pack:smoke` remains the structural package-isolation gate; the runtime report adds production latency and memory budgets rather than replacing it.

This work does not change the editor API, Markdown compatibility contract, resource security policy, DOM semantics, or accessibility behavior. It does fix one teardown leak found by the new benchmark: ImageView now owns and cancels its infinite loading-spinner animation when loading ends or the view is destroyed.

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
| Keydown-to-presentation proxy | milliseconds | A trusted browser `keydown` observed inside the editor through one `origin: user` document update and the next animation-frame/task presentation opportunity |
| Parse and serialization | milliseconds | Direct `codec.parse(fixture)` and `codec.serialize(parsedDocument)` calls through a public instrumentation extension; this bypasses `getMarkdown()` identity caching without private package imports |
| Teardown | milliseconds | A dirty editor's synchronous `destroy()` and required cleanup; post-destroy DOM settlement is reported separately when available |
| Mounted memory | bytes/counts | Garbage-collected Chromium JavaScript, embedder-heap, backing-storage, DOM-node, document, and listener deltas from a warmed packed-page baseline to a settled editor |
| Retained memory | bytes/counts | The same counters after destroy relative to the warmed baseline; tracked memory is the reported sum of JavaScript, embedder-heap, and backing-storage deltas |
| Bundle size | bytes | Independently built compatibility and minimal static graphs, with production raw and compressed sizes plus async chunks |

Chromium memory evidence comes from the Chrome DevTools Protocol rather than `performance.memory`. Garbage collection is performed outside latency samples. One-time module and language-loading caches are warmed before the memory baseline so retained module code is not mislabeled as an editor leak. Firefox and WebKit timing can be recorded separately, but Chromium is the canonical CI memory environment.

The presentation boundary is a browser scheduling proxy, not a hardware paint or display-photon timestamp. Chromium Event Timing is retained as a diagnostic when the event exceeds its 16 ms reporting threshold. Its observer is given a bounded 100 ms post-measurement delivery window and explicitly drained without moving the saved presentation timestamp. A missing entry is recorded as censored only when the measured proxy is below the threshold; omission above the threshold invalidates the sample instead of being invented as zero. Future comparisons must keep the same boundary and must not relabel synchronous transaction time as keystroke-to-paint.

## Sampling and variance

The benchmark profile controls warmups and retained samples. The full local command uses three warmup rounds, 20 retained timing samples, and seven retained memory samples per size. CI uses one warmup, five timing samples, and three memory samples per size on a serial hosted runner. Each CDP memory sample receives a fresh browser process and performs one throwaway editor lifecycle before its baseline. Both profiles write their effective counts, size order, browser mode, and viewport into the result.

Warmups are excluded from summaries. Measured document sizes are rotated rather than always running from smallest to largest. Samples are not silently trimmed. For every primary latency and memory series the report retains raw values and records count, minimum, maximum, mean, median, nearest-rank p90 and p95, standard deviation, coefficient of variation, and median absolute deviation; Event Timing remains per-sample diagnostic metadata.

A noisy result is evidence about the run, not permission to discard inconvenient observations. Budget review must inspect both p95 and variance. The 20-sample baseline reports a meaningful nearest-rank p95; the five-sample CI profile explicitly gates on `maximum` rather than describing its maximum as p95. Memory leaves state whether they gate on maximum or median.

## Environment and provenance

`performance-results/benchmark.json` is the authoritative machine-readable result. It must identify enough context to distinguish a product regression from an environment change:

- Git revision and dirty-worktree state
- Operating system, release, architecture, CPU model, logical cores, and total memory
- Node.js, pnpm, Playwright, and browser versions
- Browser user agent, headless mode, viewport, device-pixel ratio, and hardware concurrency
- Benchmark profile, generator version, exact fixture sizes, and structural counts
- Packed package versions, tarball hashes, and resolved packed entry points
- Raw samples, summary statistics, budget evaluations, and unsupported metrics

The canonical CI environment is the serial `ubuntu-24.04`, Node.js 24, pinned-pnpm and pinned-Playwright Chromium job in `.github/workflows/performance.yml`. Local results remain useful, but their hardware and browser identity must accompany any comparison with CI.

## Approved local baseline

The initial approved evidence is `performance/baseline.json`, captured on 2026-07-17 from the candidate EE-013 tree based on revision `234e6cb`. It used an Apple M4 Max with 16 logical CPUs and 64 GiB RAM, macOS/Darwin 25.5.0 arm64, Node.js 25.6.0, pnpm 10.6.5, Playwright 1.61.1, and headless Chromium 149.0.7827.55. The report records the dirty candidate-tree state, packed tarball hash, stable packed module provenance, fixture hashes, browser details, raw samples, and SHA-256 hashes for every harness input.

These rounded values summarize the full 3-warmup, 20-timing, 7-memory local run. Latencies are p95; mounted tracked memory is the median; retained tracked memory is the maximum.

| Exact bytes | Sync mount | Mount to presentation | Codec parse | Codec serialize | Keydown proxy | Dirty teardown | Mounted tracked memory | Retained tracked memory |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 102,400 | 56.2 ms | 103.6 ms | 8.1 ms | 4.6 ms | 13.8 ms | 14.2 ms | 11.7 MB | 0.45 MB |
| 512,000 | 235.1 ms | 399.5 ms | 37.7 ms | 112.6 ms | 139.6 ms | 158.0 ms | 57.9 MB | 0.20 MB |
| 1,048,576 | 633.6 ms | 934.2 ms | 88.6 ms | 408.4 ms | 477.0 ms | 501.5 ms | 116.8 MB | 0.17 MB |

All 21 measured teardown lifecycles retained zero DOM nodes, event listeners, and documents after garbage collection. The benchmark initially exposed an ImageView spinner-animation leak of roughly 6,200 detached nodes per 100 KiB lifecycle; the product fix and the zero-retention baseline are part of this item.

This macOS result approves the first regression ceilings but is not presented as an Ubuntu measurement. The workflow runner is the canonical enforcement environment, records its actual Node/browser/hardware details on every run, and uploads both runtime and bundle JSON. The thresholds include reviewed Linux-runner headroom; the first CI artifact becomes the canonical cross-environment comparison without rewriting the approved limits.

## Warning and failure policy

Each enforced metric has an explicit warning ceiling and failure ceiling. A value above the warning ceiling emits a visible CI annotation without failing the job. A value above the failure ceiling emits an error and makes `pnpm perf:ci` fail. Missing required samples, non-finite results, fixture drift, packed-consumer provenance failure, or an incompatible report schema are measurement failures rather than performance passes. Both drivers retain phase-attributed partial evidence for operational failures and replace workspace, home, and temporary paths with stable tokens before CI uploads it.

Budgets are fixed reviewed values in `performance/budgets.json`; the current run never rewrites or rebases them automatically. CI requires exactly one warmup, five timing samples, three memory samples, every required document size, the pinned viewport/context contract, and the declared isolation topology. Timing variability warns above a coefficient of variation of 0.25 and invalidates the run above 0.60. Warning/failure latency ceilings provide approximately two-to-three times the local baseline plus reviewed hosted-runner allowance. Memory ceilings are tighter for structural counts and deliberately permit limited CDP heap noise. These are regression ceilings, not aspirational interaction targets; EE-014 and EE-015 must improve the current large-document hot paths beneath them.

The approved record is:

| Field | Approved value |
| --- | --- |
| Baseline date and revision | 2026-07-17 candidate tree based on `234e6cb`; full raw evidence in `performance/baseline.json` |
| Local baseline browser/hardware | Chromium 149.0.7827.55; Apple M4 Max, 16 logical CPUs, 64 GiB, Darwin 25.5.0 arm64 |
| Canonical enforcement environment | `ubuntu-24.04`, Node.js 24.x, pnpm 10.6.5, Playwright 1.61.1 Chromium; actual versions and hardware recorded per artifact |
| Runtime latency ceilings | Explicit maximum warning/failure leaves for all six metrics and three sizes in `performance/budgets.json` |
| Memory ceilings | Explicit clean-teardown, tracked-memory, DOM-node, listener, and document leaves; retained listeners/documents must remain zero |
| Compatibility bundle baseline | 1,264,908 B initial JS, 570,072 B lazy JS, 15,503 B CSS, 154 static modules |
| Minimal bundle baseline | 678,165 B JS, 12,851 B CSS, no lazy chunks, 126 static modules |

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

Both commands write `performance-results/benchmark.json`. The directory is intentionally ignored because run evidence is environment-specific; CI uploads the JSON artifact. Approved baseline values and budgets are checked in separately through the focused `EE-013` review.

These package commands are the stable entry points around `scripts/performance-benchmark.mjs`; callers should not depend on its internal flags. The local entry selects the full baseline defaults, while the CI entry selects the CI profile and enables budget checking.

When investigating a regression, compare the raw series, variance, environment, fixture version, and tarball hashes before attributing a change to editor code. Reproduce on the same environment and profile before proposing a budget change.
